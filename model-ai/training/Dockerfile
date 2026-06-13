FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY train_behavior_lora.py /app/train_behavior_lora.py

CMD ["python", "/app/train_behavior_lora.py"]
