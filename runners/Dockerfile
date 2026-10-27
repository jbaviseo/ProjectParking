# Start from the official n8n runners image (it already has Python & Node setup correctly)
FROM n8nio/runners:2.4.6
# Switch to root just to install packages
USER root
# 1. (Optional) Install extra JS libraries if you need them
# RUN cd /opt/runners/task-runner-javascript && pnpm add moment uuid
# 2. Copy your python requirements
COPY requirements.txt /opt/runners/task-runner-python/requirements.txt
# 3. Install them using 'uv' (It's built-in and much faster than pip)
RUN cd /opt/runners/task-runner-python && uv pip install -r requirements.txt
# Switch back to the secure runner user
USER runner