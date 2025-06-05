# c:\Users\bapoh\Downloads\russian-notam-parser\proxy_server.py
from http.server import SimpleHTTPRequestHandler, HTTPServer
import requests
import urllib.parse
import json
import os

# Целевой URL, к которому будут проксироваться запросы
# Можно сделать более общим, если нужно проксировать к разным хостам,
# но для данного случая ограничимся FAA.
ALLOWED_PROXY_HOST = "https://www.notams.faa.gov"

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
        elif path == "/load_notams":
            print("Loading NOTAMs from file...")
            if os.path.exists(DATA_FILE):
                try:
                    with open(DATA_FILE, 'w', encoding='utf-8') as f:
                    # ensure_ascii=False позволяет сохранять русские символы
                    json.dump(data, f, indent=2, ensure_ascii=False)
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.end_headers()
                    # ensure_ascii=False позволяет сохранять русские символы
                    self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))
                    print(f"Loaded {len(data)} NOTAMs from {DATA_FILE}")
                except Exception as e:
                    print(f"Error loading data: {e}")
                    self.send_error(500, f"Error loading data: {e}")
            else:
                print(f"Data file not found: {DATA_FILE}")
                # Отправляем 200 с пустым массивом, если файл еще не создан
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
    print(f"Access your HTML at http://localhost:{port}/notam_map.html")
    print("NOTAM requests will be proxied.")
    httpd.serve_forever()

if __name__ == '__main__':
    # Убедитесь, что у вас установлена библиотека requests:
    # pip install requests
    run()
