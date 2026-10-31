FROM python:3.15-alpine

RUN apk add --no-cache curl

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py ./

EXPOSE 8083 8084

CMD ["python", "server.py"]
