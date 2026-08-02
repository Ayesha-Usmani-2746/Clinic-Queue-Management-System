from flask import Blueprint, request, jsonify
from db import get_db
from datetime import date as dt_date

appointments_bp = Blueprint('appointments', __name__)

DEPT_COUNTER = {
    'General OPD': 1,
    'Dental':      2,
    'ENT':         3,
    'Cardiology':  4,
}

@appointments_bp.route('/book', methods=['POST'])
def book_appointment():
    try:
        data   = request.get_json()
        name   = (data.get('name')   or '').strip()
        phone  = (data.get('phone')  or '').strip()
        email  = data.get('email')
        age    = data.get('age')
        gender = data.get('gender')
        dept   = (data.get('department') or '').strip()
        date   = data.get('date')
        time   = data.get('time')
        notes  = data.get('notes')

        if not all([name, phone, dept, date, time]):
            return jsonify({'error': 'Missing required fields'}), 400

        db = get_db()

        # Save patient
        patient_res = db.table('patients').insert({
            'name':   name,
            'phone':  phone,
            'email':  email  or None,
            'age':    int(age) if age else None,
            'gender': gender or None,
        }).execute()
        patient_id = patient_res.data[0]['id']

        counter_num = DEPT_COUNTER.get(dept, 1)

        # Count appointments on the same day for ordering
        existing = db.table('appointments').select('id', count='exact') \
                     .eq('appt_date', date).execute()
        position = (existing.count or 0) + 1

        # Save appointment — uses appt_date / appt_time (our schema columns)
        result = db.table('appointments').insert({
            'patient_id':     patient_id,
            'department':     dept,
            'counter_number': counter_num,
            'appt_date':      date,
            'appt_time':      time,
            'status':         'scheduled',
            'notes':          notes or None,
        }).execute()

        appt_id = result.data[0]['id']
        print(f'✅ Appointment {appt_id} — {name} — {dept} — {date} {time}')

        return jsonify({
            'success':        True,
            'appointment_id': appt_id,
            'position':       position,
            'department':     dept,
            'counter':        counter_num,
            'date':           date,
            'time':           time,
            'name':           name,
        })

    except Exception as e:
        print(f'❌ Appointment booking error: {e}')
        return jsonify({'error': str(e)}), 500


@appointments_bp.route('/all', methods=['GET'])
def get_all_appointments():
    try:
        db  = get_db()
        res = db.table('appointments') \
                .select('*, patients(name, phone, email)') \
                .order('appt_date').execute()

        result = []
        for row in res.data:
            p = row.get('patients') or {}
            result.append({
                'id':         row['id'],
                'department': row['department'],
                'appt_date':  str(row.get('appt_date', '')),
                'appt_time':  str(row.get('appt_time', ''))[:5],
                'status':     row['status'],
                'notes':      row.get('notes'),
                'name':       p.get('name', 'Unknown'),
                'phone':      p.get('phone', ''),
                'email':      p.get('email', ''),
            })
        return jsonify(result)

    except Exception as e:
        print(f'❌ Get appointments error: {e}')
        return jsonify([])


@appointments_bp.route('/today', methods=['GET'])
def get_today_appointments():
    try:
        today = dt_date.today().isoformat()
        db    = get_db()
        res   = db.table('appointments') \
                  .select('*, patients(name, phone)') \
                  .eq('appt_date', today) \
                  .order('appt_time').execute()

        result = []
        for row in res.data:
            p = row.get('patients') or {}
            result.append({
                'id':         row['id'],
                'department': row['department'],
                'appt_time':  str(row.get('appt_time', ''))[:5],
                'status':     row['status'],
                'name':       p.get('name', 'Unknown'),
                'phone':      p.get('phone', ''),
            })
        return jsonify(result)

    except Exception as e:
        print(f'❌ Today appointments error: {e}')
        return jsonify([])


@appointments_bp.route('/confirm/<int:appt_id>', methods=['POST'])
def confirm_appointment(appt_id):
    try:
        db = get_db()
        db.table('appointments').update({'status': 'confirmed'}) \
          .eq('id', appt_id).execute()
        return jsonify({'message': 'Appointment confirmed'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@appointments_bp.route('/cancel/<int:appt_id>', methods=['POST'])
def cancel_appointment(appt_id):
    try:
        db = get_db()
        db.table('appointments').update({'status': 'cancelled'}) \
          .eq('id', appt_id).execute()
        return jsonify({'message': 'Appointment cancelled'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500