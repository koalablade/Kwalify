import datetime

def log(level, component, message, **kwargs):
    ts = datetime.datetime.utcnow().isoformat()
    extra = " ".join(f"{k}={v}" for k, v in kwargs.items())
    print(f"[{ts}] [{level}] [{component}] {message} {extra}")