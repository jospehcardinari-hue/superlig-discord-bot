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
    return text
        .trim()
        .toLocaleUpperCase("tr-TR");
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

function formatTurkeyDateTime(date, time) {
    if (!date) {
        return {
            date: "Henüz açıklanmadı",
            time: "Henüz açıklanmadı"
        };
    }

    try {
        const rawTime =
            time && time !== ""
                ? time
                : "00:00:00";

        const iso =
            `${date}T${rawTime}Z`;

        const value =
            new Date(iso);

        const formattedDate =
            new Intl.DateTimeFormat(
                "tr-TR",
                {
                    timeZone: "Europe/Istanbul",
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric"
                }
            ).format(value);

        const formattedTime =
            new Intl.DateTimeFormat(
                "tr-TR",
                {
                    timeZone: "Europe/Istanbul",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false
                }
            ).format(value);

        return {
            date: formattedDate,
            time: formattedTime
        };

    } catch {
        return {
            date,
            time: time || "Henüz açıklanmadı"
        };
    }
}

async function getFixtures() {
    const url =
        `https://www.thesportsdb.com/api/v1/json/${API_KEY}/eventsseason.php` +
        `?id=${LEAGUE_ID}&s=${SEASON}`;

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(
            `TheSportsDB HTTP ${response.status}`
        );
    }

    const data =
        await response.json();

    return data.events || [];
}

function parseMatches(events) {
    return events
        .filter(event => {
            return (
                isBigFour(event.strHomeTeam) ||
                isBigFour(event.strAwayTeam)
            );
        })
        .map(event => {
            const turkey =
                formatTurkeyDateTime(
                    event.dateEvent,
                    event.strTime
                );

            return {
                id: event.idEvent,

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
                    "?"
            };
        });
}

async function sendDiscord(match) {
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
                    `📋 ${match.round}. Hafta`,

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
                    text: "Kaynak: TheSportsDB"
                }
            }
        ]
    };

    const response = await fetch(
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

async function main() {
    try {
        console.log("");
        console.log("==============================");
        console.log("⚽ SÜPER LİG BOT");
        console.log("==============================");
        console.log("");

        const events =
            await getFixtures();

        const matches =
            parseMatches(events);

        const sent =
            loadSent();

        console.log(
            `${matches.length} adet 4 büyük maçı bulundu.`
        );

        console.log("");

        for (const match of matches) {

            console.log(
                `${match.date} ${match.time}`
            );

            console.log(
                `${match.home} vs ${match.away}`
            );

            console.log(
                `🏟️ ${match.venue}`
            );

            console.log("");

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

        console.log("==============================");
        console.log("✅ Kontrol tamamlandı.");
        console.log("==============================");

    } catch (error) {

        console.error("");
        console.error(
            "❌ HATA:",
            error.message
        );
    }
}

main();