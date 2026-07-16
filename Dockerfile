FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/data.sqlite

# შენიშვნა: VOLUME ინსტრუქცია განზრახ არ არის — Railway მას არ უჭერს მხარს.
# ლოკალურად: docker run -v anonimo_data:/data ...; Railway/Fly-ზე volume პლატფორმიდან ებმება.
RUN mkdir -p /data

EXPOSE 3000
CMD ["node", "server.js"]
