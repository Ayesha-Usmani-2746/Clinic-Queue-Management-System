from flask import Blueprint, request, jsonify
from datetime import datetime
import requests as http_req

queue_bp = Blueprint('queue', __name__)

DEPT_COUNTER = {
    'General OPD': 1,
    'Dental':      2,
    'ENT':         3,
    'Cardiology':  4,
}

def get_counter_for_dept(department):
    return DEPT_COUNTER.get(department, 1)

def get_db_safe():
    """Get DB, auto-reset on END_STREAM errors."""
    from db import get_db
    return get_db()

def get_on_duty_doctor(db, counter_number):
    try:
        now      = datetime.now()
        time_str = now.strftime('%H:%M')
        day_abbr = now.strftime('%a')
        res = db.table('doctors').select('*') \
                .eq('counter_number', counter_number) \
                .eq('is_active', True).execute()
        if not res.data:
            return f'Counter {counter_number} Doctor'
        for doc in res.data:
            days  = [d.strip() for d in (doc.get('days_of_week') or '').split(',')]
            start = str(doc['shift_start'])[:5]
            end   = str(doc['shift_end'])[:5]
            if day_abbr in days and start <= time_str < end:
                return doc['name']
        return res.data[0]['name']
    except Exception as e:
        print(f'⚠️ Doctor lookup: {e}')
        return f'Counter {counter_number} Doctor'


def try_auto_serve(db, counter_num):
    """If counter is idle and has waiting tokens, immediately serve next one."""
    try:
        c_res = db.table('counters').select('status') \
                  .eq('counter_number', counter_num).execute()
        if not c_res.data or c_res.data[0]['status'] == 'active':
            return None

        serving_check = db.table('tokens').select('id', count='exact') \
                          .eq('counter_number', counter_num) \
                          .eq('status', 'serving').execute()
        if (serving_check.count or 0) > 0:
            return None

        next_res = db.table('tokens') \
                     .select('*, patients(name, phone)') \
                     .eq('status', 'waiting') \
                     .eq('counter_number', counter_num) \
                     .order('token_number').limit(1).execute()
        if not next_res.data:
            return None

        nt          = next_res.data[0]
        p           = nt.get('patients') or {}
        doctor_name = get_on_duty_doctor(db, counter_num)

        db.table('tokens').update({'status': 'serving'}).eq('id', nt['id']).execute()
        db.table('counters').update({
            'status':        'active',
            'current_token': nt['token_number'],
            'doctor_name':   doctor_name,
        }).eq('counter_number', counter_num).execute()

        print(f'🚀 Auto-served Token {nt["token_number"]} → C{counter_num} ({doctor_name})')
        return {
            'id':         nt['id'],
            'token':      nt['token_number'],
            'counter':    counter_num,
            'doctor':     doctor_name,
            'name':       p.get('name', 'Patient'),
            'department': nt['department'],
            'empty':      False,
        }
    except Exception as e:
        print(f'❌ try_auto_serve: {e}')
        return None


def broadcast(payload, event='token-updated'):
    """Fire socket event via the internal broadcast endpoint."""
    try:
        import os
        port = os.getenv('PORT', '5000')
        http_req.post(f'http://localhost:{port}/internal/broadcast',
                      json={'event': event, 'payload': payload}, timeout=2)
    except Exception:
        pass

# ── Book a walk-in token ──────────────────────────────────
@queue_bp.route('/book', methods=['POST'])
def book_token():
    from db import get_db, reset_db
    for attempt in range(2):   # retry once on END_STREAM
        try:
            data    = request.get_json()
            name    = (data.get('name') or '').strip()
            phone   = (data.get('phone') or '').strip()
            email   = data.get('email')
            age     = data.get('age')
            gender  = data.get('gender')
            dept    = (data.get('department') or '').strip()
            address = data.get('address')
            notes   = data.get('notes')

            if not name or not dept or not phone:
                return jsonify({'error': 'Name, phone and department are required'}), 400
            if dept not in DEPT_COUNTER:
                return jsonify({'error': f'Unknown department: {dept}'}), 400

            db = get_db()

            patient_res = db.table('patients').insert({
                'name':    name,  'phone':   phone,
                'email':   email  or None,
                'age':     int(age) if age else None,
                'gender':  gender  or None,
                'address': address or None,
            }).execute()
            patient_id = patient_res.data[0]['id']

            counter_num = get_counter_for_dept(dept)
            doctor_name = get_on_duty_doctor(db, counter_num)

            last_res   = db.table('tokens').select('token_number') \
                           .order('token_number', desc=True).limit(1).execute()
            next_token = (last_res.data[0]['token_number'] + 1) if last_res.data else 1

            w_res         = db.table('tokens').select('id', count='exact') \
                              .eq('status', 'waiting').eq('department', dept).execute()
            waiting_count = w_res.count or 0

            db.table('tokens').insert({
                'token_number':   next_token,
                'patient_id':     patient_id,
                'department':     dept,
                'status':         'waiting',
                'counter_number': counter_num,
                'notes':          notes or None,
            }).execute()

            db.table('counters').update({'doctor_name': doctor_name}) \
              .eq('counter_number', counter_num).execute()

            print(f'✅ Token {next_token} → {dept} → C{counter_num} ({doctor_name})')

            auto = try_auto_serve(db, counter_num)
            if auto:
                broadcast(auto, 'token-updated')

            remaining_res = db.table('tokens').select('token_number, department, counter_number') \
                              .eq('status', 'waiting').order('token_number').execute()
            remaining = [{'token_number': r['token_number'], 'department': r['department'],
                          'counter_number': r.get('counter_number')} for r in remaining_res.data]

            auto_served = auto is not None
            return jsonify({
                'token':       next_token,
                'waitTime':    0 if auto_served else waiting_count * 10,
                'department':  dept,
                'name':        name,
                'counter':     counter_num,
                'doctor':      doctor_name,
                'position':    0 if auto_served else waiting_count + 1,
                'auto_served': auto_served,
                'queue':       remaining,
            })

        except Exception as e:
            err_str = str(e)
            print(f'❌ Book error (attempt {attempt+1}): {err_str}')
            if 'END_STREAM' in err_str or 'trailer' in err_str.lower():
                print('🔄 Resetting DB client...')
                reset_db()
                continue   # retry
            return jsonify({'error': err_str}), 500

    return jsonify({'error': 'Server error, please try again'}), 500


# ── Get waiting tokens ────────────────────────────────────
@queue_bp.route('/waiting', methods=['GET'])
def get_waiting():
    from db import get_db, reset_db
    for attempt in range(2):
        try:
            db  = get_db()
            res = db.table('tokens').select('*, patients(name, phone)') \
                    .eq('status', 'waiting').order('token_number').execute()
            result = []
            for row in res.data:
                p = row.get('patients') or {}
                result.append({
                    'id':             row['id'],
                    'token_number':   row['token_number'],
                    'department':     row['department'],
                    'status':         row['status'],
                    'counter_number': row.get('counter_number'),
                    'issued_at':      row['issued_at'],
                    'name':           p.get('name', 'Unknown'),
                    'phone':          p.get('phone', ''),
                })
            return jsonify(result)
        except Exception as e:
            if 'END_STREAM' in str(e) or 'trailer' in str(e).lower():
                reset_db(); continue
            print(f'❌ Waiting: {e}')
            return jsonify([])
    return jsonify([])


# ── Get all tokens ────────────────────────────────────────
@queue_bp.route('/all', methods=['GET'])
def get_all():
    from db import get_db, reset_db
    for attempt in range(2):
        try:
            db  = get_db()
            res = db.table('tokens') \
                    .select('*, patients(name, phone, email, age, gender)') \
                    .order('token_number', desc=True).limit(100).execute()
            result = []
            for row in res.data:
                p = row.get('patients') or {}
                result.append({
                    'id':             row['id'],
                    'token_number':   row['token_number'],
                    'department':     row['department'],
                    'status':         row['status'],
                    'counter_number': row.get('counter_number'),
                    'issued_at':      row['issued_at'],
                    'served_at':      row.get('served_at'),
                    'name':           p.get('name', 'Unknown'),
                    'phone':          p.get('phone', ''),
                    'email':          p.get('email', ''),
                    'age':            p.get('age'),
                    'gender':         p.get('gender', ''),
                })
            return jsonify(result)
        except Exception as e:
            if 'END_STREAM' in str(e) or 'trailer' in str(e).lower():
                reset_db(); continue
            print(f'❌ All: {e}')
            return jsonify([])
    return jsonify([])


# ── Call next (manual) ───────────────────────────────────
@queue_bp.route('/next', methods=['POST'])
def call_next():
    from db import get_db, reset_db
    for attempt in range(2):
        try:
            data    = request.get_json() or {}
            counter = data.get('counter')
            if not counter:
                return jsonify({'error': 'counter is required'}), 400
            counter = int(counter)
            db = get_db()

            db.table('tokens').update({'status': 'done'}) \
              .eq('counter_number', counter).eq('status', 'serving').execute()
            db.table('counters').update({'status': 'idle', 'current_token': None}) \
              .eq('counter_number', counter).execute()

            result = try_auto_serve(db, counter)
            if not result:
                return jsonify({'message': 'Queue empty for this counter', 'empty': True})

            remaining_res = db.table('tokens').select('token_number, department, counter_number') \
                              .eq('status', 'waiting').order('token_number').execute()
            result['queue'] = [{'token_number': r['token_number'], 'department': r['department'],
                                 'counter_number': r.get('counter_number')} for r in remaining_res.data]
            return jsonify(result)
        except Exception as e:
            if 'END_STREAM' in str(e) or 'trailer' in str(e).lower():
                reset_db(); continue
            print(f'❌ Next: {e}')
            return jsonify({'error': str(e)}), 500
    return jsonify({'error': 'Server error'}), 500


# ── Mark done ────────────────────────────────────────────
@queue_bp.route('/done/<int:token_id>', methods=['POST'])
def mark_done(token_id):
    from db import get_db, reset_db
    for attempt in range(2):
        try:
            db  = get_db()
            res = db.table('tokens').select('counter_number').eq('id', token_id).execute()
            if not res.data:
                return jsonify({'error': 'Token not found'}), 404
            cnum = res.data[0].get('counter_number')
            db.table('tokens').update({'status': 'done'}).eq('id', token_id).execute()
            if cnum:
                db.table('counters').update({'status': 'idle', 'current_token': None}) \
                  .eq('counter_number', cnum).execute()
                auto = try_auto_serve(db, cnum)
                if auto:
                    broadcast(auto, 'token-updated')
                    return jsonify({'message': 'Done — next auto-served', 'next': auto})
            return jsonify({'message': 'Marked as done'})
        except Exception as e:
            if 'END_STREAM' in str(e) or 'trailer' in str(e).lower():
                reset_db(); continue
            print(f'❌ Done: {e}')
            return jsonify({'error': str(e)}), 500
    return jsonify({'error': 'Server error'}), 500


# ── Stats ────────────────────────────────────────────────
@queue_bp.route('/stats', methods=['GET'])
def get_stats():
    from db import get_db, reset_db
    for attempt in range(2):
        try:
            db = get_db()
            from datetime import date
            today = date.today().isoformat()   # e.g. '2026-06-01'
            w  = db.table('tokens').select('id', count='exact').eq('status', 'waiting').execute()
            s  = db.table('tokens').select('id', count='exact').eq('status', 'serving').execute()
            # Only count tokens issued TODAY
            d  = db.table('tokens').select('id', count='exact')                    .eq('status', 'done')                    .gte('issued_at', f'{today}T00:00:00')                    .lte('issued_at', f'{today}T23:59:59').execute()
            a  = db.table('counters').select('id', count='exact').eq('status', 'active').execute()
            iq = w.count or 0
            return jsonify({'inQueue': iq, 'serving': s.count or 0,
                            'servedToday': d.count or 0, 'activeCounters': a.count or 0,
                            'avgWait': iq * 10})
        except Exception as e:
            if 'END_STREAM' in str(e) or 'trailer' in str(e).lower():
                reset_db(); continue
            print(f'❌ Stats: {e}')
            return jsonify({'inQueue':0,'serving':0,'servedToday':0,'activeCounters':0,'avgWait':0})
    return jsonify({'inQueue':0,'serving':0,'servedToday':0,'activeCounters':0,'avgWait':0})


# ── Serving ──────────────────────────────────────────────
@queue_bp.route('/serving', methods=['GET'])
def get_serving():
    from db import get_db, reset_db
    for attempt in range(2):
        try:
            db  = get_db()
            res = db.table('tokens').select('*, patients(name)') \
                    .eq('status', 'serving').order('counter_number').execute()
            result = []
            for row in res.data:
                p = row.get('patients') or {}
                result.append({'id': row['id'], 'token_number': row['token_number'],
                               'department': row['department'],
                               'counter_number': row.get('counter_number'),
                               'name': p.get('name', 'Patient')})
            return jsonify(result)
        except Exception as e:
            if 'END_STREAM' in str(e) or 'trailer' in str(e).lower():
                reset_db(); continue
            print(f'❌ Serving: {e}')
            return jsonify([])
    return jsonify([])


# ── Patients ─────────────────────────────────────────────
@queue_bp.route('/patients', methods=['GET'])
def get_patients():
    from db import get_db, reset_db
    for attempt in range(2):
        try:
            db  = get_db()
            res = db.table('patients').select('*').order('created_at', desc=True).limit(200).execute()
            return jsonify(res.data)
        except Exception as e:
            if 'END_STREAM' in str(e) or 'trailer' in str(e).lower():
                reset_db(); continue
            print(f'❌ Patients: {e}')
            return jsonify([])
    return jsonify([])


# ── Daily stats ───────────────────────────────────────────
@queue_bp.route('/daily-stats', methods=['GET'])
def daily_stats():
    """Return per-day served counts for the last 30 days."""
    for attempt in range(2):
        try:
            from db import get_db, reset_db          # ← was missing, caused the crash
            from datetime import date, timedelta
            db   = get_db()
            rows = db.table('tokens').select('issued_at') \
                     .eq('status', 'done') \
                     .order('issued_at', desc=True).execute()

            from collections import defaultdict
            counts = defaultdict(int)
            for row in rows.data:
                day = str(row['issued_at'])[:10]   # 'YYYY-MM-DD'
                counts[day] += 1

            # Build last 30 days (fills zeros for days with no patients)
            result = []
            for i in range(29, -1, -1):
                d   = (date.today() - timedelta(days=i)).isoformat()
                result.append({'date': d, 'served': counts.get(d, 0)})

            return jsonify(result)
        except Exception as e:
            if 'END_STREAM' in str(e) or 'trailer' in str(e).lower():
                reset_db(); continue
            print(f'❌ Daily stats: {e}')
            return jsonify([])
    return jsonify([])