FROM alpine:3.20

# Install common tools available in the sandbox
RUN apk add --no-cache \
    bash \
    coreutils \
    curl \
    git \
    grep \
    jq \
    python3 \
    py3-pip \
    nodejs \
    npm \
    sed \
    awk \
    findutils \
    tree

# Create non-root user for sandbox execution
RUN adduser -D -u 1000 sandbox
USER sandbox
WORKDIR /workspace

# Default entrypoint
ENTRYPOINT ["/bin/sh", "-c"]
