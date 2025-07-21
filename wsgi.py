from http.server import HTTPServer
from proxy_server import CORSRequestHandler

# Gunicorn буде використовувати цей об'єкт 'app' для запуску сервера
app = HTTPServer(('', 8000), CORSRequestHandler)