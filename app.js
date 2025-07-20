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
document.getElementById('refresh-notams-button')?.addEventListener('click', () => {
    const selectedAirport = document.getElementById('airport-filter')?.value || "all";
    if (selectedAirport === "all") {
        console.log("Запит на оновлення NOTAM вручну для всіх аеропортів...");
        loadNotam(true); // Викликаємо функцію завантаження з прапором примусового оновлення для всіх
    } else {
        console.log(`Запит на оновлення NOTAM вручну для ${selectedAirport}...`);
        loadNotam(true, selectedAirport); // Викликаємо з вказівкою конкретного ICAO
    }
});
// Запускаємо завантаження NOTAMів після повної завантаження DOM
document.addEventListener('DOMContentLoaded', async () => {
    uiManager.populateAirportFilter(); // Заповнюємо фільтр аеропортів при завантаженні сторінки
    const initialLoad = await loadNotam();
    allNotams = initialLoad.notams;
    newNotamIds = initialLoad.newIds;
    applyFilters();
});
