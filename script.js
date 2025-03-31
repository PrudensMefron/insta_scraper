const puppeteer = require('puppeteer');
const axios = require('axios');
require('dotenv').config();

async function instagramScraper(usernames, webhook) {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    slowMo: 50, // Sem atraso extra
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36'
  );
  await page.setCacheEnabled(false);

  // Objeto para acompanhar quais usernames já foram processados
  const processedUsernames = {};

  // Listener global para todas as responses da URL desejada
  page.on('response', async (response) => {
    const url = response.url();
    if (url.startsWith("https://www.instagram.com/graphql/query")) {
      console.log("Interceptou response GraphQL:", url);
      try {
        const data = await response.json();
        if (data?.data?.user && data.data.user.username && data.data.user.id) {
          const userFromResponse = data.data.user.username.toLowerCase();
          const userId = data.data.user.id;
          for (let username of usernames) {
            const cleanUsername = username.replace("@", "").toLowerCase();
            // Envia apenas se ainda não foi processado (undefined)
            if (cleanUsername === userFromResponse && processedUsernames[cleanUsername] === undefined) {
              console.log(`Encontrado ${username} com ID ${userId}`);
              processedUsernames[cleanUsername] = userId; // Marca como encontrado
              try {
                await axios.post(webhook, { username, id: userId, found: true });
                console.log(`Webhook enviado para ${username}`);
              } catch (error) {
                console.error(`Erro ao enviar webhook para ${username}:`, error.message);
              }
            }
          }
        }
      } catch (err) {
        console.error("Erro ao processar response:", err.message);
      }
    }
  });

  try {
    // Acessa a página inicial do Instagram e realiza o login, se necessário
    await page.goto('https://instagram.com', { waitUntil: 'domcontentloaded', timeout: 60000 }); // Aumenta o timeout para 60 segundos
    const pageTitle = await page.title();
    if (pageTitle === 'Instagram') {
      console.log('Página de login encontrada; inserindo credenciais...');
      const usernameSelector = 'input[name="username"]';
      await page.waitForSelector(usernameSelector, { timeout: 5000 });
      await page.type(usernameSelector, process.env.INSTA_USER, { delay: 0 });
      const passwordSelector = 'input[name="password"]';
      await page.waitForSelector(passwordSelector, { timeout: 5000 });
      await page.type(passwordSelector, process.env.INSTA_PASS, { delay: 0 });
      await page.click('button[type="submit"]');
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 120000 }); // Aumenta o timeout para 60 segundos
    }

    // Itera sobre os usernames para acessar os perfis
    for (const username of usernames) {
      const cleanUsername = username.replace(/[@\s%20]/g, "");
      const profileUrl = `https://instagram.com/${cleanUsername}`;
      console.log(`Navegando para ${profileUrl}`);

      try {
        await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        // Aguarda 10 segundos para que as requisições sejam disparadas
        await new Promise(resolve => setTimeout(resolve, 10000));

        // Se após aguardar 10s o usuário ainda não foi marcado, envia o webhook de falha
        if (processedUsernames[cleanUsername] === undefined) {
          processedUsernames[cleanUsername] = "notFound";
          try {
            await axios.post(webhook, { username, id: null, found: false });
            console.log(`Webhook enviado para ${username} com id: null e found: false`);
          } catch (error) {
            console.error(`Erro ao enviar webhook para ${username} com id: null:`, error.message);
          }
        }
      } catch (error) {
        console.error(`Erro ao navegar para o perfil de ${username}:`, error.message);
        // Em caso de erro na navegação, se ainda não estiver marcado, envia o webhook de falha.
        if (processedUsernames[cleanUsername] === undefined) {
          processedUsernames[cleanUsername] = "notFound";
          try {
            await axios.post(webhook, { username, id: null, found: false });
            console.log(`Webhook enviado para ${username} com id: null e found: false`);
          } catch (err) {
            console.error(`Erro ao enviar webhook para ${username} com id: null:`, err.message);
          }
        }
      }

      // Atraso de 10 segundos antes de processar o próximo username
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  } catch (error) {
    console.error('Erro geral:', error);
  } finally {
    await browser.close();
  }
}

const data = require('./file.json');
const usernames = data.map(item => item.instagram);
const webhook = 'https://n8nlike.likemarketing.com.br/webhook/047b4bfc-9a21-403e-aa06-8381d2772c6f';

instagramScraper(usernames, webhook);
