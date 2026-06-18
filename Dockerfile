FROM node:20-bookworm

RUN apt-get update && apt-get install -y gosu openssh-client && rm -rf /var/lib/apt/lists/*

ARG USER_ID=1000
ARG GROUP_ID=1000

WORKDIR /workspace/.mas/harness

RUN if getent passwd node >/dev/null; then deluser node; fi && \
    if ! getent group ${GROUP_ID} >/dev/null; then addgroup --gid ${GROUP_ID} appgroup; fi && \
    if ! getent passwd ${USER_ID} >/dev/null; then adduser --disabled-password --gecos "" --uid ${USER_ID} --gid ${GROUP_ID} appuser; fi

# Fix permissions on Gemin directory
RUN mkdir -p /home/appuser/.gemini && chown -R appuser:appgroup /home/appuser/.gemini

CMD ["sh", "-c", "exec gosu ${USER_ID}:${GROUP_ID} npm run serve"]
