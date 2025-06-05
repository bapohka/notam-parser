
from http.server import SimpleHTTPRequestHandler, HTTPServer
import requests
import urllib.parse
import json
import os

# Целевой URL, к которому будут проксироваться запросы
# Можно сделать более общим, если нужно проксировать к разным хостам,
# но для данного случая ограничимся FAA.
ALLOWED_PROXY_HOST = "https://www.notams.faa.gov"
# Файл для хранения/загрузки данных NOTAM
DATA_FILE = "notams_data.json" # Переконайтесь, що цей файл існує або буде створений з даними


class CORSRequestHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/proxy?url="):
            parsed_path = urllib.parse.urlparse(self.path)
            query_params = urllib.parse.parse_qs(parsed_path.query)
            target_url = query_params.get('url', [None])[0]

            if not target_url:
                self.send_error(400, "Bad Request: 'url' parameter is missing")
                return

            if not target_url.startswith(ALLOWED_PROXY_HOST):
                self.send_error(403, f"Forbidden: Proxying is only allowed to {ALLOWED_PROXY_HOST}")
                return

            try:
                print(f"Proxying request to: {target_url}")
                # Выполняем запрос к целевому серверу
                # Передаем некоторые заголовки от клиента, если это необходимо,
                # но для простоты здесь этого не делаем.
                response = requests.get(target_url, timeout=10) # Таймаут 10 секунд
                response.raise_for_status()  # Вызовет исключение для HTTP-ошибок 4xx/5xx

                # Отправляем ответ клиенту
                self.send_response(response.status_code)
                # Добавляем необходимый CORS-заголовок
                self.send_header("Access-Control-Allow-Origin", "*")

                # Копируем другие релевантные заголовки из ответа целевого сервера
                # Исключаем заголовки, которые могут вызвать проблемы или управляются сервером/прокси
                excluded_headers = [
                    'content-encoding',      # requests сам обрабатывает распаковку
                    'transfer-encoding',
                    'connection',
                    'strict-transport-security',
                    'content-security-policy',
                    'access-control-allow-origin' # Мы устанавливаем его сами
                ]
                for key, value in response.headers.items():
                    if key.lower() not in excluded_headers:
                        self.send_header(key, value)
                self.end_headers()
                self.wfile.write(response.content)

            except requests.exceptions.HTTPError as e:
                # Ошибка от целевого сервера (4xx, 5xx)
                self.send_error(e.response.status_code, f"Error from target: {e.response.text[:200]}")
            except requests.exceptions.RequestException as e:
                # Другие ошибки запроса (сеть, таймаут и т.д.)
                self.send_error(502, f"Proxy Error: {e}") # 502 Bad Gateway
            return
        elif self.path == "/load_notams":
            print(f"Attempting to load NOTAMs from {DATA_FILE}...")
            if os.path.exists(DATA_FILE):
                try:
                    with open(DATA_FILE, 'r', encoding='utf-8') as f: # Відкриваємо на читання
                        loaded_data = json.load(f) # Завантажуємо дані з файлу

                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.end_headers()
                    self.wfile.write(json.dumps(loaded_data, ensure_ascii=False).encode('utf-8'))
                    print(f"Successfully sent {len(loaded_data)} NOTAMs from {DATA_FILE}")
                except json.JSONDecodeError as e:
                    print(f"Error decoding JSON from {DATA_FILE}: {e}")
                    self.send_error(500, f"Error decoding data file: {e}")
                except Exception as e:
                    print(f"Error reading or sending data from {DATA_FILE}: {e}")
                    self.send_error(500, f"Error processing data file: {e}")
            else:
                print(f"Data file not found: {DATA_FILE}. Sending empty array.")
                # Якщо файл не знайдено, відправляємо порожній масив
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps([]).encode('utf-8'))
            return
        else:
            # Для всех остальных путей работаем как обычный файловый сервер
            super().do_GET()

def run(server_class=HTTPServer, handler_class=CORSRequestHandler, port=8000):
    server_address = ('', port)
    httpd = server_class(server_address, handler_class)
    print(f"Starting server on http://localhost:{port}")
    print(f"Access your HTML at http://localhost:{port}/index.html")
    print("NOTAM requests will be proxied.")
    httpd.serve_forever()

if __name__ == '__main__':
    # Убедитесь, что у вас установлена библиотека requests:
    # pip install requests
    run()
