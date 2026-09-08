require("dotenv").config();
const fs = require("fs");

const WEBHOOK = process.env.DISCORD_WEBHOOK;

const API_KEY = "123";
const LEAGUE_ID = "4339";
const SEASON = "2026-2027";

const SENT_FILE = "./sent.json";

const BIG_FOUR = [
    "FENERBAHÇE",
    "FENERBAHCE",
    "GALATASARAY",
    "BEŞİKTAŞ",
    "BESIKTAS",
    "TRABZONSPOR"
];

function normalize(text = "") {
    return text.trim().toLocaleUpperCase("tr-TR");
}

function isBigFour(teamName) {
    const name = normalize(teamName);

    return BIG_FOUR.some(team =>
        name.includes(team)
    );
}

function loadSent() {
    if (!fs.existsSync(SENT_FILE)) {
        fs.writeFileSync(
            SENT_FILE,
            JSON.stringify([], null, 2)
        );

        return [];
    }

    try {
        return JSON.parse(
            fs.readFileSync(SENT_FILE, "utf8")
        );
    } catch {
        return [];
    }
}

function saveSent(sent) {
    fs.writeFileSync(
        SENT_FILE,
        JSON.stringify(sent, null, 2)
    );
}

function getEventDate(event) {
    if (!event.dateEvent) {
        return null;
    }

    const time =
        event.strTime && event.strTime.trim() !== ""
            ? event.strTime
            : "00:00:00";

    const date = new Date(
        `${event.dateEvent}T${time}Z`
    );

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date;
}

function formatTurkeyDateTime(eventDate) {
    const date =
        new Intl.DateTimeFormat(
            "tr-TR",
            {
                timeZone: "Europe/Istanbul",
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric"
            }
        ).format(eventDate);

    const time =
        new Intl.DateTimeFormat(
            "tr-TR",
            {
                timeZone: "Europe/Istanbul",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false
            }
        ).format(eventDate);

    return {
        date,
        time
    };
}

async function getFixtures() {
    const url =
        `https://www.thesportsdb.com/api/v1/json/${API_KEY}/eventsseason.php` +
        `?id=${LEAGUE_ID}&s=${SEASON}`;

    console.log("🌐 TheSportsDB fikstürü alınıyor...");

    const response =
        await fetch(url);

    if (!response.ok) {
        throw new Error(
            `TheSportsDB HTTP hatası: ${response.status}`
        );
    }

    const data =
        await response.json();

    return data.events || [];
}

function parseMatches(events) {
    const now =
        new Date();

    return events

        // 4 büyük filtresi
        .filter(event => {
            return (
                isBigFour(event.strHomeTeam || "") ||
                isBigFour(event.strAwayTeam || "")
            );
        })

        // Tarihi düzgün olan maçlar
        .map(event => {
            return {
                event,
                eventDate: getEventDate(event)
            };
        })

        .filter(item =>
            item.eventDate !== null
        )

        // GEÇMİŞ MAÇLARI BURADA ATIYORUZ
        .filter(item =>
            item.eventDate > now
        )

        // En yakın maç önce
        .sort(
            (a, b) =>
                a.eventDate - b.eventDate
        )

        .map(item => {
            const event =
                item.event;

            const turkey =
                formatTurkeyDateTime(
                    item.eventDate
                );

            return {
                id:
                    String(event.idEvent),

                home:
                    event.strHomeTeam ||
                    "Bilinmiyor",

                away:
                    event.strAwayTeam ||
                    "Bilinmiyor",

                date:
                    turkey.date,

                time:
                    turkey.time,

                venue:
                    event.strVenue ||
                    "Henüz açıklanmadı",

                round:
                    event.intRound ||
                    "?",

                eventDate:
                    item.eventDate
            };
        });
}

async function sendDiscord(match) {
    if (!WEBHOOK) {
        throw new Error(
            "DISCORD_WEBHOOK bulunamadı."
        );
    }

    const derby =
        isBigFour(match.home) &&
        isBigFour(match.away);

    const payload = {
        username: "Süper Lig Bot",

        embeds: [
            {
                title: derby
                    ? `🔥 DERBİ | ${match.home} vs ${match.away}`
                    : `⚽ ${match.home} vs ${match.away}`,

                description:
                    `🏆 **Trendyol Süper Lig**\n` +
                    `📋 **${match.round}. Hafta**`,

                fields: [
                    {
                        name: "📅 Tarih",
                        value: match.date,
                        inline: true
                    },

                    {
                        name: "⏰ Saat",
                        value: match.time,
                        inline: true
                    },

                    {
                        name: "🏟️ Stadyum",
                        value: match.venue,
                        inline: false
                    },

                    {
                        name: "🏠 Ev Sahibi",
                        value: match.home,
                        inline: true
                    },

                    {
                        name: "✈️ Deplasman",
                        value: match.away,
                        inline: true
                    }
                ],

                footer: {
                    text:
                        "Süper Lig Maç Takvimi • Kaynak: TheSportsDB"
                },

                timestamp:
                    new Date().toISOString()
            }
        ]
    };

    const response =
        await fetch(
            WEBHOOK,
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(payload)
            }
        );

    if (!response.ok) {
        const error =
            await response.text();

        throw new Error(
            `Discord ${response.status}: ${error}`
        );
    }
}

async function checkFixtures() {
    try {
        console.log("");
        console.log(
            "========================================"
        );
        console.log(
            "⚽ SÜPER LİG BOT KONTROLÜ"
        );
        console.log(
            "========================================"
        );

        console.log(
            `🕒 ${new Date().toLocaleString("tr-TR")}`
        );

        console.log("");

        const events =
            await getFixtures();

        console.log(
            `📦 API'den ${events.length} maç geldi.`
        );

        const matches =
            parseMatches(events);

        console.log(
            `🔮 Yaklaşan 4 büyük maçı: ${matches.length}`
        );

        console.log("");

        if (matches.length === 0) {
            console.log(
                "⚠️ Yaklaşan maç bulunamadı."
            );

            return;
        }

        const sent =
            loadSent();

        for (const match of matches) {

            console.log(
                `⚽ ${match.home} vs ${match.away}`
            );

            console.log(
                `📅 ${match.date} • ${match.time}`
            );

            console.log(
                `🏟️ ${match.venue}`
            );

            if (sent.includes(match.id)) {

                console.log(
                    "⏭️ Daha önce gönderilmiş."
                );

                console.log("");

                continue;
            }

            await sendDiscord(match);

            sent.push(match.id);

            saveSent(sent);

            console.log(
                "✅ Discord'a gönderildi."
            );

            console.log("");

            await new Promise(resolve =>
                setTimeout(resolve, 1500)
            );
        }

        console.log(
            "✅ Kontrol tamamlandı."
        );

    } catch (error) {

        console.error("");
        console.error(
            "❌ HATA:",
            error.message
        );
    }
}

checkFixtures();