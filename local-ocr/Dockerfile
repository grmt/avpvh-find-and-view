# Runs on YOUR machine, not the server -- see ocr_server.py. Swap the
# tesseract install below for a heavier/more accurate engine if you want;
# the plugin only depends on the POST /ocr contract in ocr_server.py.
FROM python:3.12-alpine

RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-nld wget && \
    wget -q -O /usr/share/tessdata/nld.traineddata \
      https://github.com/tesseract-ocr/tessdata_best/raw/main/nld.traineddata

COPY ocr_server.py /app/ocr_server.py
WORKDIR /app

EXPOSE 8091
CMD ["python3", "-u", "ocr_server.py"]
