FROM container-registry.oracle.com/os/oraclelinux:9-slim

RUN microdnf install -y python3.11 \
 && microdnf clean all

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app
COPY server.py /app/server.py

EXPOSE 8080
CMD ["python3.11", "/app/server.py"]
