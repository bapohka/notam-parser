
from http.server import SimpleHTTPRequestHandler, HTTPServer
import requests
import urllib.parse
import json
import os

# Цільовий URL, до якого будуть проксуватися запити
# Можна зробити більш загальним, якщо потрібно проксувати до різних хостів,
# але для даного випадку обмежимося FAA.
ALLOWED_PROXY_HOST = "https://www.notams.faa.gov"
# Файл для зберігання/завантаження даних NOTAM
DATA_FILE = "notams_data.json" # Переконайтесь, що цей файл існує або буде створений з даними


class CORSRequestHandler(SimpleHTTPRequestHandler):
    def _send_cors_error(self, status_code, message):
        """Helper to send a JSON error response with CORS headers."""
        self.send_response(status_code)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        error_payload = json.dumps({"error": message}).encode('utf-8')
        self.wfile.write(error_payload)

    def do_GET(self):
        if self.path.startswith("/proxy?url="):
            parsed_path = urllib.parse.urlparse(self.path)
            query_params = urllib.parse.parse_qs(parsed_path.query)
            target_url = query_params.get('url', [None])[0]

            if not target_url:
                self._send_cors_error(400, "Bad Request: 'url' parameter is missing")
                return

            if not target_url.startswith(ALLOWED_PROXY_HOST):
                self._send_cors_error(403, f"Forbidden: Proxying is only allowed to {ALLOWED_PROXY_HOST}")
                return

            try:
                print(f"Proxying request to: {target_url}")
                headers = {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:139.0) Gecko/20100101 Firefox/139.0"
                }
                response = requests.get(target_url, headers=headers, timeout=(20, 35))
                response.raise_for_status()  # Викличе виняток для HTTP-помилок 4xx/5xx

                self.send_response(response.status_code)
                self.send_header("Access-Control-Allow-Origin", "*")

                excluded_headers = [
                    'content-encoding',      # requests сам обробляє розпакування
                    'transfer-encoding',
                    'connection',
                    'strict-transport-security',
                    'content-security-policy',
                    'access-control-allow-origin' # Ми встановлюємо його самі
                ]
                for key, value in response.headers.items():
                    if key.lower() not in excluded_headers:
                        self.send_header(key, value)
                self.end_headers()
                self.wfile.write(response.content)

            except requests.exceptions.HTTPError as e:
                # Error from target server (4xx, 5xx)
                self._send_cors_error(e.response.status_code, f"Error from target server: {str(e)}")
            except requests.exceptions.RequestException as e:
                self._send_cors_error(502, f"Proxy Error: {str(e)}") # 502 Bad Gateway
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
                    self._send_cors_error(500, f"Error decoding data file: {e}")
                except Exception as e:
                    print(f"Error reading or sending data from {DATA_FILE}: {e}")
                    self._send_cors_error(500, f"Error processing data file: {e}")
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
            # Для всіх інших шляхів працюємо як звичайний файловий сервер
            super().do_GET()

    def do_POST(self):
        if self.path == "/save_notams_on_server":
            try:
                content_length = int(self.headers['Content-Length'])
                post_data_bytes = self.rfile.read(content_length)
                new_notams_from_client = json.loads(post_data_bytes.decode('utf-8'))

                if not isinstance(new_notams_from_client, list):
                    self._send_cors_error(400, "Bad Request: Expected a JSON list of NOTAMs.")
                    return

                existing_data = []
                if os.path.exists(DATA_FILE):
                    try:
                        with open(DATA_FILE, 'r', encoding='utf-8') as f:
                            file_content = f.read().strip() # Читаємо вміст файлу та видаляємо зайві пробіли
                            if file_content: # Перевіряємо, чи файл не порожній після видалення пробілів
                                existing_data = json.loads(file_content)
                                if not isinstance(existing_data, list):
                                    print(f"Warning: {DATA_FILE} не содержал валидный JSON список. Инициализация как пустого списка.")
                                    existing_data = []
                            else:
                                existing_data = [] # Файл порожній або містить лише пробіли
                    except json.JSONDecodeError:
                        print(f"Warning: Не удалось декодировать JSON из {DATA_FILE}. Инициализация как пустого списка.")
                        existing_data = []
                    except Exception as e:
                        print(f"Ошибка чтения {DATA_FILE}, инициализация как пустого списка: {e}")
                        existing_data = []
                
                # Логіка: нові NOTAMи (new_notams_from_client) розміщуються на початку.
                # Старі NOTAMи з файлу (existing_data), яких немає в new_notams_from_client, додаються в кінець.
                # Це запобігає дублюванню, якщо NOTAM з нової пачки вже був у файлі (використовується нова версія).
                
                new_notam_ids_from_client = {notam.get('id') for notam in new_notams_from_client if notam.get('id')}
                
                old_notams_to_keep = [
                    notam for notam in existing_data 
                    if notam.get('id') not in new_notam_ids_from_client
                ]
                
                combined_data = new_notams_from_client + old_notams_to_keep

                with open(DATA_FILE, 'w', encoding='utf-8') as f:
                    json.dump(combined_data, f, ensure_ascii=False, indent=4)

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                response_message = {"message": f"Успешно сохранено/обновлено {len(new_notams_from_client)} NOTAMов. Всего в файле: {len(combined_data)}."}
                self.wfile.write(json.dumps(response_message).encode('utf-8'))
                print(f"Данные сохранены в {DATA_FILE}. Получено {len(new_notams_from_client)}, всего в файле {len(combined_data)}.")

            except json.JSONDecodeError:
                self._send_cors_error(400, "Bad Request: Invalid JSON.")
            except Exception as e:
                print(f"Internal Server Error on POST: {e}") # Логуємо помилку на сервері
                self._send_cors_error(500, f"Internal Server Error: {str(e)}")
            return
        else:
            self._send_cors_error(404, "Not Found")

    def do_OPTIONS(self): # Для обробки CORS preflight-запитів
        self.send_response(200, "ok")
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header("Access-Control-Allow-Headers", "X-Requested-With, Content-Type")
        self.end_headers()

def run(server_class=HTTPServer, handler_class=CORSRequestHandler, port=8000):
    server_address = ('', port)
    httpd = server_class(server_address, handler_class)
    print(f"Starting server on http://localhost:{port}")
    print(f"Access your HTML at http://localhost:{port}/index.html")
    print("NOTAM requests will be proxied.")
    httpd.serve_forever()

if __name__ == '__main__':
    # Переконайтеся, що у вас встановлена бібліотека requests:
    # pip install requests
    run()
