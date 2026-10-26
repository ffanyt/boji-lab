# 薄肌研究所 server image. Standard library only, so nothing to pip install.
# Build from the repository root:   docker build -f deploy/Dockerfile -t lianshiji .
# Run it behind an HTTPS proxy (deploy/compose.example.yaml puts Caddy in front); the session cookie is HTTPS-only.
FROM python:3.12-slim
# tzdata: LSJ_TZ / TZ need the zone files, which slim images may not carry
RUN apt-get update && apt-get install -y --no-install-recommends tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && useradd -r -u 10001 lianshiji && mkdir -p /data && chown lianshiji /data
# server.py, xunji_import.py and webpush.py (which it imports from its own directory) and web/
COPY app/ /app/
USER lianshiji
ENV LSJ_DATA=/data LSJ_HOST=0.0.0.0 LSJ_PORT=8780 TZ=Asia/Shanghai LSJ_TZ=Asia/Shanghai
EXPOSE 8780
VOLUME /data
CMD ["python3", "/app/server.py"]
