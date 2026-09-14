# Lokale OCR-container

De productieserver heeft te weinig CPU/RAM voor een zwaarder, nauwkeuriger
OCR-model. Deze map is een minimale OCR-service die je op je **eigen**
computer draait; de "Lokale Docker"-optie in de crop-select-tool van de
editor stuurt de uitgesneden afbeelding rechtstreeks vanuit je browser
hierheen (geen tunnel/VPN nodig — browsers staan `http://localhost` toe
vanaf een https-pagina).

## Starten

```sh
cd local-ocr
docker build -t avpvh-local-ocr .
docker run --rm -p 8091:8091 avpvh-local-ocr
```

Laat de container draaien, open de editor, kies bij de crop-tool
"Lokale Docker (jouw computer)" en selecteer een stukje van het scanbeeld.
Standaardadres is `http://localhost:8091/ocr` — pas het tekstvak naast de
dropdown aan als je een andere poort gebruikt (wordt onthouden per browser).

## Een ander/zwaarder OCR-model gebruiken

`ocr_server.py` bevat alleen het HTTP-contract (`POST /ocr` met ruwe
afbeelding-bytes in, `{"text": "..."}` terug) rond de `tesseract`
command-line. Vervang de `subprocess.run([...])`-aanroep door iets anders
(Docling, PaddleOCR, een lokale vision-LLM, …) als je betere resultaten
wilt dan Tesseract kan geven — de plugin zelf hoeft niet te weten wat er
in de container zit.
