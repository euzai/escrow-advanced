
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./
RUN npm ci || yarn install || pnpm i
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
