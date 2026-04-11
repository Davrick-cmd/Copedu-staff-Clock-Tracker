"""
JWT and password hashing for local auth.
Uses bcrypt directly to avoid passlib/bcrypt version compatibility issues.
"""
import os
import uuid
from datetime import datetime, timedelta
import bcrypt
from jose import JWTError, jwt

SECRET_KEY = os.environ.get("SECRET_KEY", "change-me-in-production-use-env")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    if not hashed:
        return False
    try:
        # OrangeHRM / PHP often stores $2y$; Python's bcrypt expects $2b$ (same format otherwise).
        h = hashed
        if h.startswith("$2y$") or h.startswith("$2a$"):
            h = "$2b$" + h[4:]
        return bcrypt.checkpw(plain.encode("utf-8"), h.encode("utf-8"))
    except Exception:
        return False


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None


def new_id() -> str:
    return str(uuid.uuid4())
