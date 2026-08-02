from flask import Blueprint, request, jsonify
from db import get_db, reset_db
import bcrypt
import jwt
import os
import datetime
from dotenv import load_dotenv
from functools import wraps

load_dotenv()

auth_bp    = Blueprint('auth', __name__)
JWT_SECRET = os.getenv('JWT_SECRET', 'medicare_jwt_secret_key_2024')
JWT_EXPIRY = 8   # hours before token expires


# ════════════════════════════════════════════════════════
# HELPER — generate JWT token
# ════════════════════════════════════════════════════════
def generate_token(admin_id, email, name):
    payload = {
        'sub':   admin_id,          # subject (who the token is for)
        'email': email,
        'name':  name,
        'iat':   datetime.datetime.utcnow(),                          # issued at
        'exp':   datetime.datetime.utcnow() +
                 datetime.timedelta(hours=JWT_EXPIRY)                 # expiry
    }
    return jwt.encode(payload, JWT_SECRET, algorithm='HS256')


# ════════════════════════════════════════════════════════
# HELPER — verify JWT token (used as decorator)
# ════════════════════════════════════════════════════════
def verify_token(f):
    """Decorator: protects routes that require a valid JWT."""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None

        # Token can be in Authorization header: "Bearer <token>"
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            token = auth_header.split(' ')[1]

        if not token:
            return jsonify({'error': 'No token provided. Please log in.'}), 401

        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
            request.admin = payload   # attach to request for use in route
        except jwt.ExpiredSignatureError:
            return jsonify({'error': 'Session expired. Please log in again.'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'error': 'Invalid token. Please log in again.'}), 401

        return f(*args, **kwargs)
    return decorated


# ════════════════════════════════════════════════════════
# ROUTE — Login
# ════════════════════════════════════════════════════════
@auth_bp.route('/login', methods=['POST'])
def login():
    for attempt in range(2):
        try:
            data     = request.get_json()
            email    = (data.get('email') or '').strip().lower()
            password = (data.get('password') or '').strip()

            if not email or not password:
                return jsonify({'success': False,
                                'error': 'Email and password required'}), 400

            db  = get_db()
            res = db.table('admins').select('*').eq('email', email).execute()

            if not res.data:
                return jsonify({'success': False,
                                'error': 'Invalid email or password'}), 401

            admin          = res.data[0]
            stored         = admin.get('password') or admin.get('password_hash') or ''

            # ── Verify password ───────────────────────────────
            # Supports both bcrypt hashes AND plain-text (legacy)
            # so existing accounts still work before migration
            password_valid = False

            if stored.startswith('$2b$') or stored.startswith('$2a$'):
                # bcrypt hash — proper comparison
                password_valid = bcrypt.checkpw(
                    password.encode('utf-8'),
                    stored.encode('utf-8')
                )
            else:
                # Plain text (legacy) — compare directly
                # Auto-upgrade to bcrypt hash on successful login
                if stored == password:
                    password_valid = True
                    new_hash = bcrypt.hashpw(
                        password.encode('utf-8'),
                        bcrypt.gensalt(rounds=12)
                    ).decode('utf-8')
                    # Upgrade the stored password to bcrypt
                    db.table('admins').update({'password': new_hash}) \
                      .eq('id', admin['id']).execute()
                    print(f'✅ Auto-upgraded password to bcrypt for {email}')

            if not password_valid:
                return jsonify({'success': False,
                                'error': 'Invalid email or password'}), 401

            # ── Generate JWT ──────────────────────────────────
            token = generate_token(admin['id'], admin['email'], admin['name'])

            print(f'✅ Login: {email} — JWT issued (expires in {JWT_EXPIRY}h)')

            return jsonify({
                'success': True,
                'token':   token,
                'name':    admin['name'],
                'email':   admin['email'],
                'expires': JWT_EXPIRY,
            })

        except Exception as e:
            if 'END_STREAM' in str(e) or 'trailer' in str(e).lower():
                reset_db(); continue
            print(f'❌ Login error: {e}')
            return jsonify({'success': False, 'error': 'Server error'}), 500

    return jsonify({'success': False, 'error': 'Server error'}), 500


# ════════════════════════════════════════════════════════
# ROUTE — Verify token (frontend calls this on page load)
# ════════════════════════════════════════════════════════
@auth_bp.route('/verify', methods=['GET'])
@verify_token
def verify():
    """Returns admin info if token is still valid."""
    return jsonify({
        'valid': True,
        'admin': request.admin
    })


# ════════════════════════════════════════════════════════
# ROUTE — Hash an existing plain-text password manually
# (run once to migrate existing admin accounts)
# ════════════════════════════════════════════════════════
@auth_bp.route('/hash-password', methods=['POST'])
def hash_password():
    """
    One-time utility: POST {"email": "x", "password": "y"}
    to hash and save the password for an admin account.
    Remove this route in production.
    """
    data     = request.get_json()
    email    = (data.get('email') or '').strip().lower()
    password = (data.get('password') or '').strip()

    if not email or not password:
        return jsonify({'error': 'email and password required'}), 400

    hashed = bcrypt.hashpw(
        password.encode('utf-8'), bcrypt.gensalt(rounds=12)
    ).decode('utf-8')

    db = get_db()
    db.table('admins').update({'password': hashed}).eq('email', email).execute()

    return jsonify({
        'success': True,
        'message': f'Password hashed and saved for {email}',
        'hash':    hashed
    })