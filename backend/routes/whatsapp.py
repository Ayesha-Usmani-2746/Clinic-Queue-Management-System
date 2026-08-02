from flask import Blueprint, request, Response
from twilio.twiml.messaging_response import MessagingResponse
from db import get_db
from datetime import datetime

whatsapp_bp = Blueprint('whatsapp', __name__)

# Must mirror DEPT_COUNTER in queue.py
DEPARTMENTS = {
    '1': 'General OPD',
    '2': 'Dental',
    '3': 'ENT',
    '4': 'Cardiology',
}

DEPT_COUNTER = {
    'General OPD': 1,
    'Dental':      2,
    'ENT':         3,
    'Cardiology':  4,
}


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
    except Exception:
        return f'Counter {counter_number} Doctor'


@whatsapp_bp.route('/incoming', methods=['POST'])
def incoming_message():
    raw         = request.form.get('Body', '')
    message     = raw.strip().lower()
    from_number = request.form.get('From', '')

    # Ignore empty status callbacks
    if not message or not from_number:
        return Response('', mimetype='text/xml')

    print(f'📩 From: {from_number} | Message: "{message}"')

    response = MessagingResponse()
    msg      = response.message()

    # ── Greeting / book ───────────────────────────────────
    if message in ['book','BOOK','Book', 'hi', 'hello', 'start', 'token']:
        msg.body(
            '👋 Welcome to *MediCare Clinic*!\n\n'
            'Please select your department:\n\n'
            '1️⃣  General OPD\n'
            '2️⃣  Dental\n'
            '3️⃣  ENT\n'
            '4️⃣  Cardiology\n\n'
            'Reply with *1*, *2*, *3*, or *4*'
        )

    # ── Department selection ──────────────────────────────
    elif message.strip() in DEPARTMENTS:
        dept        = DEPARTMENTS[message.strip()]
        counter_num = DEPT_COUNTER[dept]

        try:
            db = get_db()

            # Doctor on duty
            doctor = get_on_duty_doctor(db, counter_num)

            # Save patient
            p_res      = db.table('patients').insert({
                'name':  'WhatsApp Patient',
                'phone': from_number,
            }).execute()
            patient_id = p_res.data[0]['id']

            # Next token number
            last_res   = db.table('tokens').select('token_number') \
                           .order('token_number', desc=True).limit(1).execute()
            next_token = (last_res.data[0]['token_number'] + 1) if last_res.data else 1

            # Waiting count for wait time estimate
            w_res      = db.table('tokens').select('id', count='exact') \
                           .eq('status', 'waiting').eq('department', dept).execute()
            wait_time  = (w_res.count or 0) * 10

            # Save token
            db.table('tokens').insert({
                'token_number':   next_token,
                'patient_id':     patient_id,
                'department':     dept,
                'status':         'waiting',
                'counter_number': counter_num,
            }).execute()

            token_str = str(next_token).zfill(3)
            msg.body(
                f'✅ *Token Issued Successfully!*\n\n'
                f'🎫 Token Number : *{token_str}*\n'
                f'🏥 Department   : {dept}\n'
                f'🚪 Counter      : {counter_num}\n'
                f'👨‍⚕️ Doctor      : {doctor}\n'
                f'⏱  Est. Wait   : ~{wait_time} mins\n\n'
                f'Please arrive at the clinic and show this message at reception.\n\n'
                f'Reply *STATUS {token_str}* to check your position.'
            )

            print(f'✅ WhatsApp Token {next_token} → {dept} → C{counter_num}')

        except Exception as e:
            print(f'❌ WhatsApp booking error: {e}')
            msg.body('⚠️ Something went wrong. Please send *BOOK* to try again.')

    # ── Status check ─────────────────────────────────────
    elif message.startswith('status'):
        parts        = message.split()
        token_lookup = parts[1] if len(parts) > 1 else None

        if token_lookup and token_lookup.isdigit():
            try:
                db  = get_db()
                res = db.table('tokens').select('*, patients(name)') \
                        .eq('token_number', int(token_lookup)).limit(1).execute()

                if res.data:
                    t     = res.data[0]
                    ahead = db.table('tokens').select('id', count='exact') \
                              .eq('status', 'waiting') \
                              .eq('department', t['department']) \
                              .lt('token_number', int(token_lookup)).execute()
                    ahead_count = ahead.count or 0

                    status_emoji = {'waiting': '⏳', 'serving': '✅', 'done': '🏁'}.get(t['status'], '❓')
                    msg.body(
                        f'📋 *Token {token_lookup} Status*\n\n'
                        f'{status_emoji} Status    : {t["status"].upper()}\n'
                        f'🏥 Department: {t["department"]}\n'
                        f'🔢 Ahead     : {ahead_count} patients\n'
                        f'⏱  Est. Wait : ~{ahead_count * 10} mins'
                    )
                else:
                    msg.body(f'❌ Token *{token_lookup}* not found.')
            except Exception as e:
                msg.body('⚠️ Could not check status. Try again.')
        else:
            msg.body('Please send *STATUS <token_number>*\nExample: STATUS 003')

    # ── Unknown ───────────────────────────────────────────
    else:
        msg.body(
            '🤔 I didn\'t understand that.\n\n'
            'Send *BOOK* to get a token\n'
            'Send *STATUS 001* to check your turn\n'
            'Send *1-4* to pick a department directly'
        )

    return Response(str(response), mimetype='text/xml')