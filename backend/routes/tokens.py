from flask import Blueprint, request, jsonify
from db import get_db, reset_db
from datetime import datetime

tokens_bp = Blueprint('tokens', __name__)


def get_db_safe():
    from db import get_db, reset_db
    for attempt in range(2):
        try:
            return get_db()
        except Exception as e:
            if 'END_STREAM' in str(e) or 'trailer' in str(e).lower():
                reset_db()
            else:
                raise
    return get_db()


def sync_active_doctors(db, counter_number):
    """
    For a given counter, look at the current time and day,
    activate the doctor whose shift is NOW, deactivate all others.
    Returns the name of the active doctor (or None).
    """
    now      = datetime.now()
    time_str = now.strftime('%H:%M')
    day_abbr = now.strftime('%a')   # 'Mon', 'Tue', ...

    res = db.table('doctors').select('*') \
            .eq('counter_number', counter_number).execute()
    if not res.data:
        return None

    active_name = None
    for doc in res.data:
        days  = [d.strip() for d in (doc.get('days_of_week') or '').split(',')]
        start = str(doc['shift_start'])[:5]   # 'HH:MM'
        end   = str(doc['shift_end'])[:5]
        should_be_active = (day_abbr in days) and (start <= time_str < end)

        if should_be_active and active_name is None:
            # Activate this one
            if not doc['is_active']:
                db.table('doctors').update({'is_active': True}).eq('id', doc['id']).execute()
            active_name = doc['name']
        else:
            # Deactivate if it shouldn't be on
            if doc['is_active']:
                db.table('doctors').update({'is_active': False}).eq('id', doc['id']).execute()

    return active_name


def shifts_overlap(start1, end1, start2, end2):
    """Return True if two time ranges overlap. Times are 'HH:MM' strings."""
    return start1 < end2 and start2 < end1


# ── Get all counters ──────────────────────────────────────
@tokens_bp.route('/counters', methods=['GET'])
def get_counters():
    for attempt in range(2):
        try:
            db  = get_db()
            # First sync active doctors for all counters
            counters_res = db.table('counters').select('*').order('counter_number').execute()
            for c in counters_res.data:
                active = sync_active_doctors(db, c['counter_number'])
                if active:
                    db.table('counters').update({'doctor_name': active}) \
                      .eq('counter_number', c['counter_number']).execute()
            # Re-fetch after sync
            res = db.table('counters').select('*').order('counter_number').execute()
            return jsonify(res.data)
        except Exception as e:
            if 'END_STREAM' in str(e) or 'trailer' in str(e).lower():
                reset_db(); continue
            print(f'❌ Counters: {e}')
            return jsonify([])
    return jsonify([])


# ── Get all doctors ───────────────────────────────────────
@tokens_bp.route('/doctors', methods=['GET'])
def get_doctors():
    for attempt in range(2):
        try:
            db = get_db()
            # Sync active status before returning
            counters_res = db.table('counters').select('counter_number').execute()
            for c in counters_res.data:
                sync_active_doctors(db, c['counter_number'])
            res = db.table('doctors').select('*').order('counter_number').execute()
            return jsonify(res.data)
        except Exception as e:
            if 'END_STREAM' in str(e) or 'trailer' in str(e).lower():
                reset_db(); continue
            return jsonify([])
    return jsonify([])


# ── Add a new doctor ──────────────────────────────────────
@tokens_bp.route('/doctors', methods=['POST'])
def add_doctor():
    try:
        data           = request.get_json()
        name           = (data.get('name') or '').strip()
        counter_number = int(data.get('counter_number', 1))
        department     = (data.get('department') or '').strip()
        shift_start    = str(data.get('shift_start', '09:00'))[:5]
        shift_end      = str(data.get('shift_end',   '14:00'))[:5]
        days_of_week   = data.get('days_of_week', 'Mon,Tue,Wed,Thu,Fri')

        if not name or not department:
            return jsonify({'error': 'Name and department are required'}), 400

        # Validate shift times
        if shift_start >= shift_end:
            return jsonify({'error': 'Shift start must be before shift end'}), 400

        db = get_db()

        # Check for overlapping shifts on the same counter
        existing = db.table('doctors').select('*') \
                     .eq('counter_number', counter_number).execute()
        for doc in existing.data:
            es = str(doc['shift_start'])[:5]
            ee = str(doc['shift_end'])[:5]
            if shifts_overlap(shift_start, shift_end, es, ee):
                return jsonify({
                    'error': f'Shift overlaps with {doc["name"]} '
                             f'({es}–{ee}) on Counter {counter_number}. '
                             f'Please choose non-overlapping hours.'
                }), 400

        # Determine if this doctor should be active right now
        now      = datetime.now()
        time_str = now.strftime('%H:%M')
        day_abbr = now.strftime('%a')
        days     = [d.strip() for d in days_of_week.split(',')]
        is_active_now = (day_abbr in days) and (shift_start <= time_str < shift_end)

        # If this doctor is active now, deactivate others on same counter
        if is_active_now:
            db.table('doctors').update({'is_active': False}) \
              .eq('counter_number', counter_number).execute()

        res = db.table('doctors').insert({
            'name':           name,
            'counter_number': counter_number,
            'department':     department,
            'shift_start':    shift_start,
            'shift_end':      shift_end,
            'days_of_week':   days_of_week,
            'is_active':      is_active_now,
        }).execute()

        # Update counter's doctor name if this one is active now
        if is_active_now:
            db.table('counters').update({'doctor_name': name}) \
              .eq('counter_number', counter_number).execute()

        return jsonify({'message': f'Dr. {name} added', 'doctor': res.data[0]})

    except Exception as e:
        print(f'❌ Add doctor: {e}')
        return jsonify({'error': str(e)}), 500


# ── Update a doctor ───────────────────────────────────────
@tokens_bp.route('/doctors/<int:doctor_id>', methods=['PUT'])
def update_doctor(doctor_id):
    try:
        data    = request.get_json()
        db      = get_db()

        # If updating shift times, check for overlaps
        if 'shift_start' in data or 'shift_end' in data:
            curr = db.table('doctors').select('*').eq('id', doctor_id).execute()
            if curr.data:
                doc        = curr.data[0]
                new_start  = str(data.get('shift_start', doc['shift_start']))[:5]
                new_end    = str(data.get('shift_end',   doc['shift_end']))[:5]
                cnum       = doc['counter_number']

                if new_start >= new_end:
                    return jsonify({'error': 'Start must be before end'}), 400

                siblings = db.table('doctors').select('*') \
                             .eq('counter_number', cnum) \
                             .neq('id', doctor_id).execute()
                for sib in siblings.data:
                    es = str(sib['shift_start'])[:5]
                    ee = str(sib['shift_end'])[:5]
                    if shifts_overlap(new_start, new_end, es, ee):
                        return jsonify({
                            'error': f'Shift overlaps with {sib["name"]} ({es}–{ee}). '
                                     f'Please choose non-overlapping hours.'
                        }), 400

        updates = {}
        for field in ['name', 'counter_number', 'department',
                      'shift_start', 'shift_end', 'days_of_week', 'is_active']:
            if field in data:
                updates[field] = data[field]

        # If manually activating, deactivate all others on same counter first
        if data.get('is_active') is True:
            curr = db.table('doctors').select('counter_number').eq('id', doctor_id).execute()
            if curr.data:
                cnum = curr.data[0]['counter_number']
                db.table('doctors').update({'is_active': False}) \
                  .eq('counter_number', cnum).neq('id', doctor_id).execute()

        res = db.table('doctors').update(updates).eq('id', doctor_id).execute()

        # Re-sync counter doctor name
        if res.data:
            cnum = res.data[0]['counter_number']
            sync_active_doctors(db, cnum)
            active = next((d for d in
                db.table('doctors').select('name').eq('counter_number', cnum)
                   .eq('is_active', True).execute().data), None)
            if active:
                db.table('counters').update({'doctor_name': active['name']}) \
                  .eq('counter_number', cnum).execute()

        return jsonify({'message': 'Doctor updated'})

    except Exception as e:
        print(f'❌ Update doctor: {e}')
        return jsonify({'error': str(e)}), 500


# ── POST alias: /doctors/update/<id>  (called by frontend JS) ─
# The JS calls POST /tokens/doctors/update/<id> with {is_active: bool}
@tokens_bp.route('/doctors/update/<int:doctor_id>', methods=['POST', 'OPTIONS'])
def update_doctor_post(doctor_id):
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    try:
        data      = request.get_json() or {}
        db        = get_db()
        is_active = data.get('is_active')

        if is_active is None:
            return jsonify({'error': 'is_active field required'}), 400

        # If activating, deactivate all others on the same counter first
        if is_active is True:
            curr = db.table('doctors').select('counter_number').eq('id', doctor_id).execute()
            if curr.data:
                cnum = curr.data[0]['counter_number']
                db.table('doctors').update({'is_active': False}) \
                  .eq('counter_number', cnum).neq('id', doctor_id).execute()

        db.table('doctors').update({'is_active': is_active}) \
          .eq('id', doctor_id).execute()

        # Sync counter's doctor_name
        curr = db.table('doctors').select('counter_number').eq('id', doctor_id).execute()
        if curr.data:
            cnum = curr.data[0]['counter_number']
            active = sync_active_doctors(db, cnum)
            if active:
                db.table('counters').update({'doctor_name': active}) \
                  .eq('counter_number', cnum).execute()

        return jsonify({'message': f'Doctor {"activated" if is_active else "deactivated"}'}), 200

    except Exception as e:
        print(f'❌ update_doctor_post: {e}')
        return jsonify({'error': str(e)}), 500


# ── POST alias: /doctors/delete/<id>  (called by frontend JS) ─
@tokens_bp.route('/doctors/delete/<int:doctor_id>', methods=['POST', 'OPTIONS'])
def delete_doctor_post(doctor_id):
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    try:
        db   = get_db()
        curr = db.table('doctors').select('counter_number').eq('id', doctor_id).execute()
        db.table('doctors').delete().eq('id', doctor_id).execute()
        if curr.data:
            cnum = curr.data[0]['counter_number']
            sync_active_doctors(db, cnum)
        return jsonify({'message': 'Doctor deleted'}), 200
    except Exception as e:
        print(f'❌ delete_doctor_post: {e}')
        return jsonify({'error': str(e)}), 500


# ── POST alias: /doctors/add  (called by frontend JS) ─────────
@tokens_bp.route('/doctors/add', methods=['POST', 'OPTIONS'])
def add_doctor_post(doctor_id=None):
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    # Delegate to the main add route logic
    try:
        data           = request.get_json() or {}
        name           = (data.get('name') or '').strip()
        counter_number = int(data.get('counter') or data.get('counter_number', 1))
        department     = (data.get('department') or '').strip()
        shift_start    = str(data.get('start') or data.get('shift_start', '09:00'))[:5]
        shift_end      = str(data.get('end')   or data.get('shift_end',   '17:00'))[:5]
        days_of_week   = (data.get('days') or data.get('days_of_week', 'Mon,Tue,Wed,Thu,Fri,Sat'))

        if not name or not department:
            return jsonify({'error': 'Name and department required'}), 400
        if shift_start >= shift_end:
            return jsonify({'error': 'Start time must be before end time'}), 400

        db = get_db()

        # Check overlapping shifts
        existing = db.table('doctors').select('*') \
                     .eq('counter_number', counter_number).execute()
        for doc in existing.data:
            es = str(doc['shift_start'])[:5]
            ee = str(doc['shift_end'])[:5]
            if shifts_overlap(shift_start, shift_end, es, ee):
                return jsonify({
                    'error': f'Shift overlaps with {doc["name"]} ({es}–{ee}) on Counter {counter_number}.'
                }), 400

        from datetime import datetime
        now      = datetime.now()
        time_str = now.strftime('%H:%M')
        day_abbr = now.strftime('%a')
        days     = [d.strip() for d in days_of_week.split(',')]
        is_active_now = (day_abbr in days) and (shift_start <= time_str < shift_end)

        if is_active_now:
            db.table('doctors').update({'is_active': False}) \
              .eq('counter_number', counter_number).execute()

        res = db.table('doctors').insert({
            'name':           name,
            'counter_number': counter_number,
            'department':     department,
            'shift_start':    shift_start,
            'shift_end':      shift_end,
            'days_of_week':   days_of_week,
            'is_active':      is_active_now,
        }).execute()

        if is_active_now:
            db.table('counters').update({'doctor_name': name}) \
              .eq('counter_number', counter_number).execute()

        return jsonify({'message': f'Dr. {name} added successfully', 'doctor': res.data[0]}), 200

    except Exception as e:
        print(f'❌ add_doctor_post: {e}')
        return jsonify({'error': str(e)}), 500
    try:
        db = get_db()
        # Get counter before deleting
        curr = db.table('doctors').select('counter_number').eq('id', doctor_id).execute()
        db.table('doctors').delete().eq('id', doctor_id).execute()
        # Sync remaining doctors on that counter
        if curr.data:
            cnum = curr.data[0]['counter_number']
            sync_active_doctors(db, cnum)
        return jsonify({'message': 'Doctor deleted'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ── Token status ──────────────────────────────────────────
@tokens_bp.route('/status/<int:token_number>', methods=['GET'])
def token_status(token_number):
    try:
        db  = get_db()
        res = db.table('tokens').select('*, patients(name)') \
                .eq('token_number', token_number).limit(1).execute()
        if not res.data:
            return jsonify({'error': 'Token not found'}), 404
        token = res.data[0]
        p     = token.get('patients') or {}
        ahead = db.table('tokens').select('id', count='exact') \
                  .eq('status', 'waiting') \
                  .eq('department', token['department']) \
                  .lt('token_number', token_number).execute()
        return jsonify({
            'token_number':   token['token_number'],
            'status':         token['status'],
            'department':     token['department'],
            'counter_number': token.get('counter_number'),
            'name':           p.get('name', 'Unknown'),
            'aheadInQueue':   ahead.count or 0,
            'estimatedWait':  (ahead.count or 0) * 10,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ── Reset queue ───────────────────────────────────────────
@tokens_bp.route('/reset', methods=['POST'])
def reset_queue():
    for attempt in range(2):
        try:
            db = get_db()
            db.table('tokens').delete().neq('id', 0).execute()
            db.table('patients').delete().neq('id', 0).execute()
            db.table('counters').update({
                'status': 'idle', 'current_token': None
            }).neq('id', 0).execute()
            return jsonify({'message': 'Queue reset successfully'})
        except Exception as e:
            if 'END_STREAM' in str(e) or 'trailer' in str(e).lower():
                reset_db(); continue
            return jsonify({'error': str(e)}), 500
    return jsonify({'error': 'Server error'}), 500


# ── Sync all counters now (called on startup or manually) ─
@tokens_bp.route('/sync-doctors', methods=['POST'])
def sync_all_doctors():
    """Manually trigger doctor sync for all counters."""
    try:
        db           = get_db()
        counters_res = db.table('counters').select('counter_number').execute()
        synced       = []
        for c in counters_res.data:
            cnum   = c['counter_number']
            active = sync_active_doctors(db, cnum)
            if active:
                db.table('counters').update({'doctor_name': active}) \
                  .eq('counter_number', cnum).execute()
            synced.append({'counter': cnum, 'active_doctor': active})
        return jsonify({'synced': synced})
    except Exception as e:
        return jsonify({'error': str(e)}), 500