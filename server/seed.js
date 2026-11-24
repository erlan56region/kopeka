'use strict';
/**
 * Демо-данные: пользователи, объявления, переписка и сделки.
 * Запускается один раз, если база пустая (npm run seed — принудительно).
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { db, saveNow, id, now } = require('./db');

const PKG = path.join(__dirname, '..', 'public', 'seed');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

function photo(file) {
  // Отдаём статикой из /seed/ — база остаётся маленькой и читаемой
  return fs.existsSync(path.join(PKG, file)) ? '/seed/' + file : null;
}

function hoursAgo(h) { return now() - h * 3600 * 1000; }

function seed(force = false) {
  const d = db();
  if (d.meta.seeded && !force) return false;
  d.version = 1;
  if (force) {
    Object.assign(d, {
      version: 1, users: [], sessions: {}, ads: [], chats: [], messages: [],
      favorites: [], deals: [], reviews: [], version: 1, meta: { seeded: false },
    });
  }

  const mkUser = (name, phone, city, password, extra = {}) => {
    const u = {
      id: id('u_'),
      name, phone, city,
      password: hashPassword(password),
      avatar: null,
      about: extra.about || '',
      ratingSum: extra.ratingSum || 0,
      ratingCount: extra.ratingCount || 0,
      createdAt: hoursAgo(extra.days || 40),
      verified: extra.verified !== false,
    };
    d.users.push(u);
    return u;
  };

  const anna = mkUser('Анна', '+79990000001', 'Москва', 'demo1234', {
    about: 'Продаю вещи из дома, всё в хорошем состоянии. Отвечаю быстро.',
    ratingSum: 48, ratingCount: 10,
  });
  const igor = mkUser('Игорь', '+79990000002', 'Москва', 'demo1234', {
    about: 'Ремонт техники, перевозки по городу. Работаю официально.',
    ratingSum: 45, ratingCount: 9,
  });
  const maria = mkUser('Мария', '+79990000003', 'Санкт-Петербург', 'demo1234', {
    about: 'Мебель и декор. Помогу с погрузкой.',
    ratingSum: 19, ratingCount: 4,
  });
  const pavel = mkUser('Павел', '+79990000004', 'Казань', 'demo1234', {
    about: 'Автомобили с историей. Проверка перед покупкой.',
    ratingSum: 9, ratingCount: 2,
  });

  const ads = [
    {
      owner: anna, title: 'iPhone 13, 128 ГБ, белый', price: 42000, category: 'Электроника',
      condition: 'Хорошее', city: 'Москва', metro: 'м. Тверская',
      photo: 'iphone.jpg', createdHours: 2, views: 148, delivery: true, transfer: true,
      description: 'Телефон в идеальном состоянии, аккумулятор 89%. В комплекте коробка и кабель. Не вскрывался, следов использования почти нет.\n\nВозможен обмен на iPhone 14 с моей доплатой.',
    },
    {
      owner: anna, title: 'Диван-кровать серый, 200×90 см', price: 9000, category: 'Для дома и дачи',
      condition: 'Хорошее', city: 'Москва', metro: 'м. Бабушкинская',
      photo: 'sofa.jpg', createdHours: 7, views: 96, delivery: false, transfer: true,
      description: 'Раскладной диван-кровать, механизм «еврокнижка». Спальное место 200×90. Ткань не потёрта, есть небольшие следы на подлокотнике.\n\nСамовывоз или помогу организовать перевозку — есть знакомый водитель.',
    },
    {
      owner: igor, title: 'Велосипед городской 28", 21 скорость', price: 15500, category: 'Хобби и отдых',
      condition: 'Отличное', city: 'Москва', metro: 'м. Кузьминки',
      photo: 'bike.jpg', createdHours: 11, views: 210, delivery: true, transfer: true,
      description: 'Откатано один сезон, всё обслужено: новые колодки, смазка цепи. Рама 19", рост 175–185 см. В подарок замок и насос.',
    },
    {
      owner: pavel, title: 'Sedan 2014, 1.6 АКПП, 112 000 км', price: 715000, category: 'Транспорт',
      condition: 'Хорошее', city: 'Казань', metro: '',
      photo: 'car.jpg', createdHours: 26, views: 1340, delivery: false, transfer: false,
      description: 'Один владелец, ПТС оригинал, сервисная книжка. Обслуживание по регламенту, недавно заменены масло и тормозные колодки. Показ в любое время по договорённости.',
    },
    {
      owner: igor, title: 'PlayStation 5 + геймпад DualSense', price: 38000, category: 'Электроника',
      condition: 'Отличное', city: 'Москва', metro: 'м. Аэропорт',
      photo: 'ps5.jpg', createdHours: 3, views: 322, delivery: true, transfer: true,
      description: 'Консоль из первых партий, не перегревалась. В комплекте один геймпад, все провода, коробка. Могу продемонстрировать при встрече, подключим к телевизору.',
    },
    {
      owner: anna, title: 'Зимний пуховик, размер M', price: 3500, category: 'Личные вещи',
      condition: 'Отличное', city: 'Москва', metro: 'м. Тверская',
      photo: 'jacket.jpg', createdHours: 20, views: 64, delivery: true, transfer: false,
      description: 'Олива, тёплый, носился один сезон. Все молнии рабочие, капюшон снимается. Отправлю доставкой по РФ.',
    },
    {
      owner: maria, title: 'Кресло кожаное винтажное', price: 12000, category: 'Для дома и дачи',
      condition: 'Хорошее', city: 'Санкт-Петербург', metro: 'м. Петроградская',
      photo: 'armchair.jpg', createdHours: 30, views: 158, delivery: false, transfer: true,
      description: 'Настоящая кожа, каркас дуб. Есть естественная патина на подлокотниках. Тяжёлое, потребуется перевозка — помогу с погрузкой.',
    },
    {
      owner: igor, title: 'Шуруповёрт аккумуляторный, 2 АКБ', price: 4800, category: 'Для дома и дачи',
      condition: 'Хорошее', city: 'Москва', metro: 'м. Щукинская',
      photo: 'drill.jpg', createdHours: 44, views: 73, delivery: true, transfer: true,
      description: 'Рабочий инструмент, два аккумулятора и зарядка в кейсе. Использовался на ремонте квартиры. Патрон без люфта.',
    },
    {
      owner: maria, title: 'Коляска прогулочная, 3 положения', price: 6800, category: 'Детские товары',
      condition: 'Хорошее', city: 'Санкт-Петербург', metro: 'м. Чкаловская',
      photo: 'stroller.jpg', createdHours: 52, views: 89, delivery: false, transfer: true,
      description: 'Лёгкая, складывается одной рукой, входит в багажник. Колёса целые, ткань постирана. Есть дождевик.',
    },
    {
      owner: pavel, title: 'Гитара акустическая, полный размер', price: 8900, category: 'Хобби и отдых',
      condition: 'Хорошее', city: 'Казань', metro: '',
      photo: 'guitar.jpg', createdHours: 70, views: 121, delivery: true, transfer: true,
      description: 'Звук ровный, гриф прямой, струны новые. Отдаю с чехлом и каподастром. Можно послушать при встрече.',
    },
    {
      owner: maria, title: 'Сдам студию на длительный срок', price: 32000, category: 'Недвижимость',
      condition: 'Хорошее', city: 'Санкт-Петербург', metro: 'м. Пионерская',
      photo: null, createdHours: 14, views: 410, delivery: false, transfer: false,
      description: 'Светлая студия 26 м², вся мебель и техника. Интернет и вода включены. Только долгосрочная аренда, без животных.\n\nПоказ по договорённости, можно онлайн-показ по видео.',
    },
    {
      owner: igor, title: 'Перевезу мебель и технику по городу', price: 1500, category: 'Услуги',
      condition: 'Новое', city: 'Москва', metro: '',
      photo: null, createdHours: 5, views: 231, delivery: false, transfer: true,
      description: 'Газель, 2 грузчика, работаю по городу и области. Цена указана за первый час. Аккуратно, есть стяжки и одеяла. Оплата после разгрузки.',
    },
  ];

  const mkAd = (a) => {
    const ad = {
      id: id('a_'),
      ownerId: a.owner.id,
      title: a.title,
      description: a.description,
      price: a.price,
      category: a.category,
      condition: a.condition,
      city: a.city,
      metro: a.metro,
      photos: (a.photos || (a.photo ? [photo(a.photo)] : [])).filter(Boolean),
      deals: { meeting: true, delivery: !!a.delivery, transfer: !!a.transfer },
      status: 'active',
      views: a.views || 0,
      createdAt: hoursAgo(a.createdHours),
      updatedAt: hoursAgo(a.createdHours),
    };
    d.ads.push(ad);
    return ad;
  };

  const made = ads.map(mkAd);
  const adByTitle = (t) => made.find(a => a.title.startsWith(t));

  // Пример переписки и сделки
  const iphone = adByTitle('iPhone 13');
  const chat = {
    id: id('c_'),
    adId: iphone.id,
    buyerId: pavel.id,
    sellerId: anna.id,
    createdAt: hoursAgo(1.5),
    updatedAt: hoursAgo(0.5),
  };
  d.chats.push(chat);
  const m = (from, text, minutes, extra = {}) => d.messages.push(Object.assign({
    id: id('m_'), chatId: chat.id, fromId: from.id, text, kind: 'text',
    createdAt: hoursAgo(minutes / 60), readBy: [],
  }, extra));
  m(pavel, 'Здравствуйте! Телефон ещё актуален?', 90);
  m(anna, 'Да, актуален. Могу показать сегодня вечером или завтра днём.', 85);
  m(pavel, 'Давайте завтра в 18:00, у метро удобно?', 70);
  m(anna, 'Удобно на Тверской, у выхода №3. Скинул карточку встречи.', 60);

  const deal = {
    id: id('d_'),
    adId: iphone.id,
    chatId: chat.id,
    fromId: anna.id,
    toId: pavel.id,
    type: 'meet',
    place: 'м. Тверская, выход №3',
    when: now() + 20 * 3600 * 1000,
    price: 41000,
    comment: 'Проверим телефон, если всё ок — рассчитаемся на месте.',
    status: 'proposed',
    createdAt: hoursAgo(0.6),
    updatedAt: hoursAgo(0.6),
  };
  d.deals.push(deal);
  d.messages.push({
    id: id('m_'), chatId: chat.id, fromId: anna.id, text: 'Встреча: м. Тверская, выход №3',
    kind: 'deal', dealId: deal.id, createdAt: hoursAgo(0.6), readBy: [],
  });

  d.favorites.push({ userId: pavel.id, adId: iphone.id, createdAt: hoursAgo(3) });

  d.meta.seeded = true;
  d.meta.seedVersion = 1;
  saveNow();
  return true;
}

module.exports = { seed };

if (require.main === module) {
  const { load } = require('./db');
  load();
  const done = seed(process.argv.includes('--force'));
  console.log(done ? 'Демо-данные записаны в data/db.json' : 'База уже заполнена (используйте --force)');
}
