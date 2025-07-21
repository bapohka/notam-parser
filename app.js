import * as config from './src/config.js';
import { map } from './src/map.js';
import { fetchWithRetry, saveNotamsToServer, loadNotam } from './src/notam-api.js';
import * as uiManager from './src/ui-manager.js';

let newNotamIds = new Set(); // Зберігає ID нових NOTAM після останнього завантаження
let allNotams = []; // Зберігає всі розпарсені об'єкти NOTAM

// Функція для застосування фільтрів і оновлення карти/списку
function applyFilters() {
        // Отримуємо стан фільтра "Нові"
    const showNewOnly = document.getElementById('filter-new')?.checked || false;
    const showUnlimitedHeightOnly = document.getElementById('filter-unlimited-height')?.checked || false;
        // Отримуємо вибрані типи NOTAM з чекбоксів
    const typeCheckboxes = document.querySelectorAll('.type-filter'); // Отримуємо всі чекбокси типів
    const selectedTypes = Array.from(typeCheckboxes)
                                .filter(cb => cb.id !== 'filter-new') // Виключаємо чекбокс "Тільки нові"
                                .filter(cb => cb.checked)
                                .map(cb => cb.value);
    const selectedAirport = document.getElementById('airport-filter')?.value || "all";

    console.log('Применяются фильтры - Типи:', selectedTypes, 'Нові:', showNewOnly, 'Без обмеж. висоти:', showUnlimitedHeightOnly, 'Аеропорт:', selectedAirport);

    // Фільтруємо всі завантажені NOTAMи
    const filteredNotams = allNotams.filter(notam => {
        // Якщо жоден тип не вибрано АБО вибраний тип присутній у списку
        // Переконаємося, що notam.notamType існує перед перевіркою
        const typeMatch = selectedTypes.length === 0 || (notam.notamType && selectedTypes.includes(notam.notamType));
        const newMatch = !showNewOnly || newNotamIds.has(notam.id);
        const unlimitedHeightMatch = !showUnlimitedHeightOnly || (notam.G && notam.G.toUpperCase() === 'UNL');
        const airportMatch = selectedAirport === "all" || (notam.A && notam.A.trim() === selectedAirport);

        return typeMatch && newMatch && unlimitedHeightMatch && airportMatch;
    });

    // Оновлюємо карту і список з відфільтрованими NOTAMами
    uiManager.updateMap(filteredNotams);
    uiManager.updateNotamList(filteredNotams);
}

// Додаємо слухачі подій для чекбоксів фільтрів типів
document.querySelectorAll('.type-filter').forEach(checkbox => {
    checkbox.addEventListener('change', applyFilters);
});
// Додаємо слухачі для інших фільтрів
document.getElementById('filter-new')?.addEventListener('change', applyFilters);
document.getElementById('filter-unlimited-height')?.addEventListener('change', applyFilters);
document.getElementById('airport-filter')?.addEventListener('change', applyFilters);


// Додаємо слухач для кнопки "Оновити NOTAM"
const refreshButton = document.getElementById('refresh-notams-button');
if (refreshButton) {
    refreshButton.addEventListener('click', () => {
        console.log("Запит на ручне оновлення NOTAM...");
        // Примусово оновлюємо дані та оновлюємо інтерфейс після завершення
        loadNotam(true).then(updatedData => {
            allNotams = updatedData.notams;
            newNotamIds = updatedData.newIds;
            applyFilters();
            console.log("Інтерфейс оновлено після ручного запиту.");
        });
    });
}

// --- Нова логіка ініціалізації додатку ---

/**
 * Завантажує початкові дані з локального файлу notams_data.json через сервер
 * і негайно відображає їх на карті.
 */
async function loadInitialData() {
    console.log("Крок 1: Завантаження початкових NOTAM з файлу notams_data.json...");
    try {
        // Прямий запит до файлу. Це працює як для статичного сайту,
        // так і для локального сервера, який віддає статичні файли.
        const response = await fetch('./notams_data.json');
        if (!response.ok) {
            throw new Error(`Помилка HTTP: ${response.status}`);
        }
        const notamsFromFile = await response.json();
        
        allNotams = notamsFromFile;
        newNotamIds.clear(); // При початковому завантаженні "нових" NOTAM немає
        
        console.log(`Завантажено ${allNotams.length} NOTAM з файлу. Відображення...`);
        applyFilters(); // Відображаємо дані на карті та у списку

    } catch (error) {
        console.error("Не вдалося завантажити початкові дані з файлу:", error);
        // Можна показати повідомлення користувачу через uiManager
    }
}

/**
 * Запускає повне оновлення NOTAM з віддаленого сервера у фоновому режимі.
 */
async function updateInBackground() {
    console.log("Крок 2: Запуск фонового оновлення NOTAM з сервера...");
    const updatedData = await loadNotam(true); // Використовуємо існуючу функцію з примусовим оновленням
    allNotams = updatedData.notams;
    newNotamIds = updatedData.newIds;
    console.log("Фонове оновлення завершено. Оновлення інтерфейсу...");
    applyFilters(); // Оновлюємо інтерфейс з новими даними
}

document.addEventListener('DOMContentLoaded', () => {
    uiManager.populateAirportFilter();

    const isLocalEnv = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    // Деактивуємо кнопку оновлення, якщо ми не в локальному середовищі
    if (refreshButton && !isLocalEnv) {
        refreshButton.disabled = true;
        refreshButton.textContent = 'Оновлення недоступне';
        refreshButton.title = 'Ця функція доступна лише при локальному запуску з сервером.';
    }

    // Завжди завантажуємо початкові дані з файлу
    loadInitialData().then(() => {
        // Якщо ми в локальному середовищі, запускаємо фонове оновлення
        if (isLocalEnv) {
            console.log("Локальне середовище виявлено. Запуск фонового оновлення.");
            // Невелика затримка для плавності, щоб користувач побачив початкові дані
            setTimeout(updateInBackground, 500);
        } else {
            console.log("Статичний сайт виявлено. Фонове оновлення пропущено.");
        }
    });
});
