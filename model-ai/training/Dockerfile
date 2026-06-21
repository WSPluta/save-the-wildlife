FROM container-registry.oracle.com/os/oraclelinux:9-slim

RUN microdnf install -y python3.11 \
 && microdnf clean all

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY train_behavior_lora.py /app/train_behavior_lora.py

CMD ["python3.11", "/app/train_behavior_lora.py"]
