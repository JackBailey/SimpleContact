FROM node:lts-alpine

WORKDIR /app

COPY ["./package.json","./yarn.lock","./"]

RUN yarn

COPY . .

EXPOSE 3000

CMD ["node","."]