# ── Patch supabase proxy issue ──────────────────────────
import supabase.client as _sc
import inspect as _inspect

_orig_init = _sc.Client.__init__
def _patched_init(self, supabase_url, supabase_key, options=None):
    _orig_init(self, supabase_url, supabase_key, options=options)

try:
    sig = _inspect.signature(_orig_init)
    if 'proxy' in sig.parameters:
        import functools
        @functools.wraps(_orig_init)
        def _patched_init(self, supabase_url, supabase_key, options=None, proxy=None):
            _orig_init(self, supabase_url, supabase_key, options=options)
        _sc.Client.__init__ = _patched_init
except Exception:
    pass



from flask import Flask, jsonify, request
from flask_socketio import SocketIO
from flask_cors import CORS
from dotenv import load_dotenv
import os
import threading
import time

load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'fallbacksecret')
app.config['JWT_SECRET']  = os.getenv('JWT_SECRET', 'medicare_jwt_secret_key_2024')

CORS(app, resources={r"/*": {"origins": [
    "http://localhost:5500",
    "http://localhost:3000",
    "http://127.0.0.1:5500",
    "https://digital-clinic-queue.vercel.app",
    "*"
]}})

# websocket-only — no long-polling spam
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode='threading',
    ping_timeout=60,
    ping_interval=25,
    logger=False,
    engineio_logger=False,
    allow_upgrades=True,
    http_compression=False,
)

# ── Register blueprints ──────────────────────────────────
blueprints = [
    ('routes.queue',        'queue_bp',        '/api/queue'),
    ('routes.tokens',       'tokens_bp',       '/api/tokens'),
    ('routes.whatsapp',     'whatsapp_bp',     '/api/whatsapp'),
    ('routes.auth',         'auth_bp',         '/api/auth'),
    ('routes.appointments', 'appointments_bp', '/api/appointments'),
]

for module, bp_name, prefix in blueprints:
    try:
        mod = __import__(module, fromlist=[bp_name])
        bp  = getattr(mod, bp_name)
        app.register_blueprint(bp, url_prefix=prefix)
        print(f"[OK] {bp_name} loaded")
    except Exception as e:
        print(f"[ERROR] {bp_name}: {e}")


@app.route('/')
def home():
    return jsonify({'status': 'running'})


# ── Internal broadcast (called by queue.py after auto-serve) ──
@app.route('/internal/broadcast', methods=['POST'])
def internal_broadcast():
    data    = request.get_json() or {}
    event   = data.get('event', 'token-updated')
    payload = data.get('payload', {})
    socketio.emit(event, payload)
    return jsonify({'ok': True})


# ── Socket events ─────────────────────────────────────────
@socketio.on('connect')
def on_connect():
    pass   # no print — reduces terminal noise

@socketio.on('disconnect')
def on_disconnect():
    pass

@socketio.on('call-next')
def handle_call_next(data):
    socketio.emit('token-updated', data)

@socketio.on('mark-done')
def handle_mark_done(data):
    socketio.emit('queue-refreshed', data)


# ════════════════════════════════════════════════════════
# AUTO ADVANCE every 10 minutes
# ════════════════════════════════════════════════════════
def auto_advance_loop():
    time.sleep(90)   # wait for full startup
    while True:
        try:
            time.sleep(600)   # 10 minutes
            from db import get_db
            from routes.queue import try_auto_serve

            db           = get_db()
            counters_res = db.table('counters').select('counter_number').execute()

            for c in counters_res.data:
                cnum = c['counter_number']
                # Mark serving → done
                db.table('tokens').update({'status': 'done'}) \
                  .eq('counter_number', cnum).eq('status', 'serving').execute()
                db.table('counters').update({'status': 'idle', 'current_token': None}) \
                  .eq('counter_number', cnum).execute()
                # Pull next
                result = try_auto_serve(db, cnum)
                if result:
                    socketio.emit('token-updated', result)
                else:
                    socketio.emit('queue-refreshed', {'counter': cnum})

        except Exception as e:
            print(f"[AUTO] Error: {e}")
            time.sleep(60)


# ════════════════════════════════════════════════════════
# HOURLY DOCTOR SYNC — switches active doctor at shift boundary
# ════════════════════════════════════════════════════════
def doctor_sync_loop():
    time.sleep(30)   # wait for full startup
    while True:
        try:
            from db import get_db
            from routes.tokens import sync_active_doctors
            db           = get_db()
            counters_res = db.table('counters').select('counter_number').execute()
            for c in counters_res.data:
                cnum   = c['counter_number']
                active = sync_active_doctors(db, cnum)
                if active:
                    db.table('counters').update({'doctor_name': active})                       .eq('counter_number', cnum).execute()
                    print(f'[SYNC] Counter {cnum} → {active}')
        except Exception as e:
            print(f'[SYNC ERROR] {e}')
        time.sleep(600)   # re-check every 10 minutes

# ── Run ──────────────────────────────────────────────────
if __name__ == '__main__':
    print("\n========================================")
    print("  MediCare Clinic — Backend")
    print("  http://localhost:5000")
    print("========================================\n")

    threading.Thread(target=auto_advance_loop, daemon=True).start()
    threading.Thread(target=doctor_sync_loop,   daemon=True).start()

    socketio.run(
        app,
        host='0.0.0.0',
        port=int(os.getenv('PORT', 5000)),
        debug=False,        # ← MUST be False — debug mode double-starts everything
        use_reloader=False, # ← MUST be False — reloader kills the DB singleton
        allow_unsafe_werkzeug=True,
    )