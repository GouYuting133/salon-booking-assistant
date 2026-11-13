FROM node:24-bookworm-slim
WORKDIR /app
COPY *.cjs ./
COPY dist/ ./dist/
ENV HOST=0.0.0.0
ENV SALON_DATA_DIR=/data
CMD ["node", "server.cjs"]
