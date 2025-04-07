const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
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
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 120000 }); // Aumenta o timeout para 120 segundos
    }

    // Aguarda obrigatoriamente 3 minutos antes de iniciar o loop
    console.log('Aguardando 3 minutos antes de iniciar o processamento dos usernames...');
    for (const time of [180000, 120000, 60000, 30000, 10000]) {
      await new Promise(resolve => setTimeout(resolve, time === 10000 ? 20000 : time - (time - 10000))); // Ajusta os intervalos
      const message = time === 180000 ? 'Faltam 3 minutos...' :
                      time === 120000 ? 'Faltam 2 minutos...' :
                      time === 60000 ? 'Faltam 1 minuto...' :
                      time === 30000 ? 'Faltam 30 segundos...' :
                      'Faltam 10 segundos...';
      console.log(message);
    }
    console.log('Iniciando o processamento dos usernames...');

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

async function fetchAndUpdateData(url, outputFile) {
  // Verifica se o arquivo file.json existe e o deleta
  if (fs.existsSync(outputFile)) {
    console.log(`Arquivo ${outputFile} encontrado. Deletando...`);
    fs.unlinkSync(outputFile);
  }

  // Faz a requisição HTTP GET para obter os dados
  console.log(`Fazendo requisição para ${url}...`);
  try {
    const response = await axios.get(url);
    const data = response.data;

    // Salva o JSON no arquivo file.json
    console.log(`Salvando dados no arquivo ${outputFile}...`);
    fs.writeFileSync(outputFile, JSON.stringify(data, null, 2));
    console.log(`Dados salvos com sucesso no arquivo ${outputFile}.`);
  } catch (error) {
    console.error(`Erro ao fazer a requisição para ${url}:`, error.message);
    process.exit(1); // Encerra o script em caso de erro
  }
}

(async () => {
  const dataUrl = 'https://n8nlike.likemarketing.com.br/webhook/dba4d410-6340-42ad-98b1-68b7200f5031'; // Substitua pelo URL real
  const outputFile = './file.json';

  // Atualiza os dados antes de iniciar o scraper
  await fetchAndUpdateData(dataUrl, outputFile);

  // Lê os dados atualizados do arquivo file.json
  const data = require(outputFile);
  const usernames = data.map(item => item.instagram);
  const webhook = 'https://n8nlike.likemarketing.com.br/webhook/047b4bfc-9a21-403e-aa06-8381d2772c6f';

  // Inicia o scraper com os dados atualizados
  await instagramScraper(usernames, webhook);
})();
