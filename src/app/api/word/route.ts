import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

// IMPORTANTE: defina a variável de ambiente GEMINI_API_KEY no sistema ou no provedor (Vercel).
// Nunca exponha a chave no cliente. Este endpoint roda no servidor.

const SYSTEM_PROMPT = `
Você é um gerador de palavras para um jogo da forca em pt-BR.
Responda APENAS em JSON válido no formato:
{"word":"<palavra em maiúsculas sem acentos>", "hint":"<uma dica curta em pt-BR>"}
Regras:
- "word" deve conter apenas letras A-Z e espaços, sem acentos ou pontuação.
- Comprimento entre 4 e 14 letras (excluindo espaços).
- Temas variados (animais, objetos, profissões, lugares, etc.).
- Não repita constantemente a mesma palavra.
`;

// Mapa de descrições de temas para orientar a IA (sem banco de palavras)
const TOPIC_HINTS: Record<string, string> = {
  qualquer: 'tema livre',
  animais: 'o nome de um animal (ex.: LEAO, GATO, TUBARAO) sem acentos',
  objetos: 'o nome de um objeto (ex.: CADEIRA, MESA, LAMPADA) sem acentos',
  profissoes: 'o nome de uma profissão (ex.: MEDICO, PROFESSOR, ENGENHEIRO) sem acentos',
  lugares: 'o nome de um lugar (ex.: PRAIA, MUSEU, PARQUE) sem acentos',
  verbos: 'um verbo no infinitivo (ex.: ANDAR, COMER, VIAJAR) sem acentos',
  comidas_tipicas: 'uma comida típica (ex.: FEIJOADA, TACACA, AREPA) sem acentos',
  pontos_turisticos_mundiais: 'um ponto turístico mundial (ex.: COLISEU, BIG BEN, TAJ MAHAL) sem acentos',
  pontos_turisticos_brasileiros: 'um ponto turístico do Brasil (ex.: CRISTO REDENTOR, PELORINHO, LENCOIS MARANHENSES) sem acentos',
  paises: 'o nome de um país (ex.: BRASIL, PORTUGAL, JAPAO) sem acentos',
  // Novos tópicos
  frutas: 'o nome de uma fruta (ex.: MACA, PERA, BANANA) sem acentos',
  cores: 'o nome de uma cor (ex.: AZUL, VERDE, AMARELO) sem acentos',
  esportes: 'o nome de um esporte (ex.: FUTEBOL, VOLEI, TENIS) sem acentos',
  instrumentos_musicais: 'o nome de um instrumento musical (ex.: GUITARRA, FLAUTA, BATERIA) sem acentos',
  meios_de_transporte: 'um meio de transporte (ex.: CARRO, ONIBUS, METRO) sem acentos',
  partes_do_corpo: 'o nome de uma parte do corpo (ex.: CABECA, BRACO, PERNA) sem acentos',
  roupas: 'o nome de uma peça de roupa (ex.: CAMISA, CALCA, VESTIDO) sem acentos',
  bebidas: 'o nome de uma bebida (ex.: CAFE, SUCO, REFRIGERANTE) sem acentos',
  cidades_brasileiras: 'o nome de uma cidade do Brasil (ex.: SAO PAULO, RIO DE JANEIRO, RECIFE) sem acentos',
  capitais_mundiais: 'o nome de uma capital mundial (ex.: LISBOA, LONDRES, TOKIO) sem acentos',
  estados_brasileiros: 'o nome de um estado brasileiro (ex.: BAHIA, SAO PAULO, PARA) sem acentos',
  elementos_quimicos: 'o nome de um elemento quimico (ex.: CARBONO, ENXOFRE, MERCURIO) sem acentos',
  marcas: 'o nome de uma marca conhecida (ex.: NIKE, ADIDAS, SAMSUNG) sem acentos',
  planetas: 'o nome de um planeta (ex.: MERCURIO, VENUS, MARTE, JUPITER) sem acentos',
};

function normalizeWord(w: string) {
  return (w || '').toUpperCase().replace(/[^A-Z ]/g, '').trim();
}

export async function GET(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY não configurada no servidor.' },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(req.url);
    const difficulty = (searchParams.get('difficulty') || 'medio') as 'facil' | 'medio' | 'dificil';
    const rawTopic = (searchParams.get('topic') || 'qualquer').toLowerCase();
    const topicDesc = TOPIC_HINTS[rawTopic] || `tema ${rawTopic}`;

    // Palavras a evitar (vêm do cookie + query opcional "avoid")
    const recentCookie = req.cookies.get('recent_words')?.value || '[]';
    let recentList: string[] = [];
    try { recentList = JSON.parse(recentCookie); } catch { recentList = []; }
    recentList = Array.isArray(recentList) ? recentList.map(normalizeWord).filter(Boolean) : [];

    const avoidParam = searchParams.get('avoid');
    const avoidFromQuery = avoidParam ? avoidParam.split(',').map(normalizeWord).filter(Boolean) : [];
    const avoidSet = new Set<string>([...recentList, ...avoidFromQuery]);

    const lenRange = difficulty === 'facil' ? '4-7' : difficulty === 'dificil' ? '10-14' : '7-10';
    const [minS, maxS] = lenRange.split('-');
    const min = parseInt(minS, 10);
    const max = parseInt(maxS, 10);

    const avoidText = avoidSet.size > 0 ? `\nEvite qualquer uma destas palavras recentemente usadas: ${Array.from(avoidSet).slice(0, 30).join(', ')}` : '';
    const userPrompt = `${SYSTEM_PROMPT}\n\nGere uma palavra (${lenRange} letras, sem acentos) com ${topicDesc}. Responda somente o JSON.${avoidText}`;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const MAX_TRIES = 6;
    for (let i = 0; i < MAX_TRIES; i++) {
      const result = await model.generateContent(userPrompt);
      const text = result.response.text();
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      try {
        const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);
        const word: string = normalizeWord((parsed.word || '').toString());
        const hint: string = (parsed.hint || '').toString();
        const pureLen = word.replace(/ /g, '').length;

        // Regras de tamanho e repetição
        if (
          word &&
          pureLen >= min && pureLen <= max &&
          !avoidSet.has(word)
        ) {
          // Atualiza cookie de recentes (máx. 20)
          const nextRecent = [word, ...recentList.filter((w) => w !== word)].slice(0, 20);
          const response = NextResponse.json({ word, hint });
          response.cookies.set('recent_words', JSON.stringify(nextRecent), {
            httpOnly: false,
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 30, // 30 dias
            path: '/',
          });
          return response;
        }
      } catch {
        // tenta novamente
      }
    }

    // Se falhar em todas as tentativas, retorna erro (sem fallback local)
    return NextResponse.json(
      { error: 'Falha ao gerar palavra pela IA. Tente novamente.' },
      { status: 502 }
    );
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: 'Falha ao gerar palavra' },
      { status: 500 }
    );
  }
}
export const dynamic = 'force-dynamic';
export const revalidate = 0;