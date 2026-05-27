FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=development
ENV VITE_HOST=0.0.0.0

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN mkdir -p public/data

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
