'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type GameState = 'idle' | 'playing' | 'won' | 'lost';

const MAX_ERRORS = 6;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const KEYBOARD_ROWS: string[][] = [
  'QWERTYUIOP'.split(''),
  'ASDFGHJKL'.split(''),
  'ZXCVBNM'.split(''),
];

async function fetchWord(difficulty: string, topic: string, avoid?: string[]): Promise<{ word: string; hint: string }> {
  const params = new URLSearchParams({ difficulty, topic });
  if (avoid && avoid.length > 0) params.set('avoid', avoid.join(','));
  const res = await fetch(`/api/word?${params.toString()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Falha ao buscar palavra');
  return res.json();
}

const RECENT_WORDS_KEY = 'forca-recent-words';
function saveRecentWords(words: string[]) {
  if (typeof window !== 'undefined') {
    try { localStorage.setItem(RECENT_WORDS_KEY, JSON.stringify(words)); } catch {}
  }
}
function loadRecentWords(): string[] {
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(RECENT_WORDS_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr.map((w) => (w || '').toString().toUpperCase()).filter(Boolean).slice(0, 20);
      }
    } catch {}
  }
  return [];
}

export default function ForcaPage() {
  const [secret, setSecret] = useState<string>('');
  const [hint, setHint] = useState<string>('');
  const [guesses, setGuesses] = useState<Set<string>>(new Set());
  const [state, setState] = useState<GameState>('idle');
  const [showHint, setShowHint] = useState(false);
  const [loading, setLoading] = useState(false);
  const [difficulty, setDifficulty] = useState<'facil' | 'medio' | 'dificil'>('medio');
  const [topic, setTopic] = useState<string>('qualquer');
  const [useCustomTopic, setUseCustomTopic] = useState(false);
  const [customTopic, setCustomTopic] = useState('');
  const [extraErrors, setExtraErrors] = useState(0);
  const [wordInput, setWordInput] = useState('');
  const [apiError, setApiError] = useState<string | null>(null);
  const [recentWords, setRecentWords] = useState<string[]>(loadRecentWords);

  const normalizedSecret = useMemo(() => secret.toUpperCase(), [secret]);

  const wrongGuesses = useMemo(
    () => Array.from(guesses).filter((ch) => !normalizedSecret.includes(ch)),
    [guesses, normalizedSecret]
  );

  const wrongCount = useMemo(() => wrongGuesses.length + extraErrors, [wrongGuesses, extraErrors]);

  const masked = useMemo(() => {
    return normalizedSecret
      .split('')
      .map((ch) => (ch === ' ' ? ' ' : guesses.has(ch) ? ch : '_'))
      .join(' ');
  }, [normalizedSecret, guesses]);

  const letterCount = useMemo(() => normalizedSecret.replace(/ /g, '').length, [normalizedSecret]);
  const maskedFontSize = useMemo(() => {
    const len = letterCount;
    if (len <= 8) return '2.25rem';
    if (len <= 12) return '2rem';
    if (len <= 16) return '1.8rem';
    if (len <= 20) return '1.6rem';
    if (len <= 28) return '1.4rem';
    return '1.2rem';
  }, [letterCount]);

  const guess = useCallback(
    (letter: string) => {
      if (state !== 'playing') return;
      const L = letter.toUpperCase();
      if (guesses.has(L)) return;

      const next = new Set(guesses);
      next.add(L);
      setGuesses(next);

      const isCorrect = normalizedSecret.includes(L);
      if (!isCorrect && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          (navigator as any).vibrate?.(60);
        } catch {}
      }

      const allRevealed = normalizedSecret
        .split('')
        .every((ch) => ch === ' ' || next.has(ch));

      const errors = Array.from(next).filter((ch) => !normalizedSecret.includes(ch)).length + extraErrors;

      if (allRevealed) {
        setState('won');
      } else if (errors >= MAX_ERRORS) {
        setState('lost');
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try { (navigator as any).vibrate?.([80, 40, 80]); } catch {}
        }
      }
    },
    [guesses, normalizedSecret, state, extraErrors]
  );

  const newGame = useCallback(async () => {
    try {
      setLoading(true);
      setApiError(null);
      setShowHint(false);
      setGuesses(new Set());
      setExtraErrors(0);
      setState('playing');
      const effectiveTopic = useCustomTopic ? (customTopic.trim() || 'qualquer') : topic;
      const { word, hint } = await fetchWord(difficulty, effectiveTopic, recentWords);
      setSecret(word);
      setHint(hint);
      // Atualiza lista recente no cliente para evitar repetição nas próximas partidas
      setRecentWords((prev) => {
        const next = [word, ...prev.filter((w) => w !== word)].slice(0, 20);
        saveRecentWords(next);
        return next;
      });
    } catch (e) {
      console.error(e);
      setApiError('Não foi possível gerar uma palavra agora. Tente novamente.');
      setState('idle');
    } finally {
      setLoading(false);
    }
  }, [difficulty, topic, useCustomTopic, customTopic, recentWords]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toUpperCase();
      if (/^[A-Z]$/.test(key)) {
        e.preventDefault();
        guess(key);
      }
      if (key === 'ENTER' && state !== 'playing') newGame();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [guess, state, newGame]);

  const handleWordGuess = useCallback(() => {
    if (state !== 'playing') return;
    const norm = wordInput.trim().toUpperCase().replace(/[^A-Z]/g, '');
    if (!norm) return;
    const target = normalizedSecret.replace(/ /g, '');
    if (norm === target) {
      setState('won');
    } else {
      setExtraErrors((e) => {
        const next = e + 1;
        const totalErrors = Array.from(guesses).filter((ch) => !normalizedSecret.includes(ch)).length + next;
        if (totalErrors >= MAX_ERRORS) {
          setState('lost');
        }
        return next;
      });
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try { (navigator as any).vibrate?.(60); } catch {}
      }
    }
    setWordInput('');
  }, [state, wordInput, normalizedSecret, guesses]);

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-slate-900 dark:to-slate-800 text-slate-900 dark:text-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-8 flex-1">
         
         {/* Cabeçalho Simplificado */}
         <div className="text-center mb-8">
           <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-6">
             Jogo da Forca
           </h1>
          
          {/* Controles em linha única */}
          <div className="flex flex-wrap justify-center gap-4 mb-6">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">Dificuldade</label>
              <select
                className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                value={difficulty}
                onChange={(e) => {
                  setDifficulty(e.target.value as any);
                  if (state === 'idle') newGame();
                }}
              >
                <option value="facil">🟢 Fácil</option>
                <option value="medio">🟡 Médio</option>
                <option value="dificil">🔴 Difícil</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">Tema</label>
              <select
                className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                value={useCustomTopic ? '__custom__' : topic}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '__custom__') {
                    setUseCustomTopic(true);
                  } else {
                    setUseCustomTopic(false);
                    setTopic(v);
                    if (state === 'idle') newGame();
                  }
                }}
              >
                <option value="qualquer">🎲 Qualquer</option>
                <option value="animais">🐾 Animais</option>
                <option value="objetos">📦 Objetos</option>
                <option value="profissoes">👔 Profissões</option>
                <option value="lugares">🌍 Lugares</option>
                <option value="verbos">🔤 Verbos</option>
                <option value="comidas_tipicas">🍲 Comidas típicas</option>
                <option value="pontos_turisticos_mundiais">🗺️ Pontos turísticos mundiais</option>
                <option value="pontos_turisticos_brasileiros">🇧🇷 Pontos turísticos brasileiros</option>
                <option value="paises">🏳️ Países</option>
+               <option value="frutas">🍎 Frutas</option>
+               <option value="cores">🎨 Cores</option>
+               <option value="esportes">🏅 Esportes</option>
+               <option value="instrumentos_musicais">🎸 Instrumentos musicais</option>
+               <option value="meios_de_transporte">🚌 Meios de transporte</option>
+               <option value="partes_do_corpo">🫀 Partes do corpo</option>
+               <option value="roupas">👗 Roupas</option>
+               <option value="bebidas">🥤 Bebidas</option>
+               <option value="cidades_brasileiras">🏙️ Cidades brasileiras</option>
+               <option value="capitais_mundiais">🌐 Capitais mundiais</option>
+               <option value="estados_brasileiros">🗺️ Estados brasileiros</option>
+               <option value="elementos_quimicos">⚗️ Elementos químicos</option>
+               <option value="marcas">🏷️ Marcas</option>
+               <option value="planetas">🪐 Planetas</option>
                <option value="__custom__">✏️ Personalizado…</option>
              </select>
            </div>

            {useCustomTopic && (
              <input
                type="text"
                className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                value={customTopic}
                onChange={(e) => setCustomTopic(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') newGame(); }}
                placeholder="Digite um tema personalizado"
              />
            )}
          </div>

          {/* Botões de ação */}
          <div className="flex justify-center gap-3">
            {state === 'playing' && (
              <button
                onClick={() => {
                  if (!showHint) setShowHint(true);
                  else setShowHint(false);
                }}
                className="rounded-lg bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 text-sm font-medium transition-colors"
              >
                {showHint ? '🙈 Ocultar dica' : '💡 Pedir dica'}
              </button>
            )}
            <button
              onClick={newGame}
              disabled={loading}
              className="rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-6 py-2 text-sm font-medium transition-colors"
            >
              {loading ? '⏳ Gerando…' : '🎮 Novo jogo'}
            </button>
          </div>
        </div>

        {/* Área de erro */}
        {apiError && (
          <div className="mb-6 p-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-200 text-center">
            <p className="text-sm mb-2">{apiError}</p>
            <button
              onClick={newGame}
              className="rounded-md bg-amber-600 hover:bg-amber-700 text-white px-3 py-2 text-sm"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {/* Dica */}
        {showHint && (
          <div className="mb-6 p-4 rounded-xl border border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-600 dark:bg-blue-900/30 dark:text-blue-200 text-center">
            <p className="text-sm">💡 <strong>Dica:</strong> {hint}</p>
          </div>
        )}

        {/* Área principal do jogo */}
        <div className="bg-white/80 dark:bg-slate-800/80 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 p-6 md:p-8">
          <div className="grid lg:grid-cols-2 gap-8 items-center">
            
            {/* Hangman Drawing */}
            <div className="flex justify-center">
              <HangmanDrawing wrongCount={wrongCount} />
            </div>

            {/* Game Content */}
            <div className="space-y-6">
              {/* Estado do jogo */}
              <div className="text-center">
                {state === 'idle' ? (
                  <p className="text-slate-500">🎯 Clique em "Novo jogo" para começar</p>
                ) : (
                  <div>
                    <p
                      className="tracking-[0.12em] sm:tracking-[0.16em] font-mono select-none whitespace-nowrap overflow-x-auto max-w-full text-center"
                      style={{ fontSize: maskedFontSize, lineHeight: 1.4 }}
                    >
                      {masked}
                    </p>
                    {state === 'won' && (
                      <div className="mt-4 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-300 dark:border-emerald-600">
                        <p className="text-emerald-700 dark:text-emerald-300 font-semibold">
                          🎉 Parabéns! Você venceu!
                        </p>
                      </div>
                    )}
                    {state === 'lost' && (
                      <div className="mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-300 dark:border-red-600">
                        <p className="text-red-700 dark:text-red-300 font-semibold">
                          😞 Fim de jogo! A palavra era: <strong>{normalizedSecret}</strong>
                        </p>
                      </div>
                    )}
                  </div>
                )}
                
                {/* Estatísticas do jogo atual */}
                <div className="mt-3 flex justify-center gap-6 text-sm text-slate-600 dark:text-slate-400">
                  <span>❌ Erros: {wrongCount} / {MAX_ERRORS}</span>
                  <span>📝 Letras: {letterCount}</span>
                </div>
                
                {wrongGuesses.length > 0 && (
                  <p className="mt-2 text-sm text-slate-500">🚫 Letras erradas: {wrongGuesses.join(', ')}</p>
                )}
              </div>

              {/* Teclado virtual */}
              {state === 'playing' && (
                <div className="space-y-3">
                  {KEYBOARD_ROWS.map((row, rowIndex) => (
                    <div key={rowIndex} className="flex justify-center gap-1 sm:gap-2">
                      {row.map((letter) => {
                        const isGuessed = guesses.has(letter);
                        const isCorrect = isGuessed && normalizedSecret.includes(letter);
                        const isWrong = isGuessed && !normalizedSecret.includes(letter);
                        
                        return (
                          <button
                            key={letter}
                            onClick={() => guess(letter)}
                            disabled={isGuessed}
                            className={`
                              w-8 h-8 sm:w-10 sm:h-10 rounded-lg font-semibold text-sm transition-all
                              ${isCorrect ? 'bg-emerald-500 text-white' :
                                isWrong ? 'bg-red-500 text-white' :
                                'bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200'}
                              ${isGuessed ? 'cursor-not-allowed opacity-70' : 'hover:scale-105'}
                            `}
                          >
                            {letter}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}

              {/* Input para chutar palavra completa */}
              {state === 'playing' && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={wordInput}
                    onChange={(e) => setWordInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleWordGuess(); }}
                    placeholder="Ou chute a palavra inteira"
                    className="flex-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                  />
                  <button
                    onClick={handleWordGuess}
                    className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-medium transition-colors"
                  >
                    Chutar
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Rodapé animado */}
      <footer className="relative overflow-hidden mt-6">
        {/* Fundo em gradiente */}
        <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600" />
        {/* Blobs iluminados com animação sutil */}
        <div className="pointer-events-none absolute -left-10 -top-10 h-40 w-40 rounded-full bg-white/20 blur-3xl animate-pulse" />
        <div className="pointer-events-none absolute -right-10 -bottom-10 h-40 w-40 rounded-full bg-white/10 blur-3xl animate-pulse" />
        {/* Conteúdo do rodapé */}
        <div className="relative mx-auto max-w-5xl px-6 py-6 text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur px-4 py-2 shadow-lg ring-1 ring-white/20 hover:ring-white/30 transition">
            <span className="text-white/90 font-semibold tracking-wide text-lg sm:text-xl">
              Dev Aleksandro Alves
            </span>
          </div>
          <div className="mx-auto mt-3 h-1.5 w-28 rounded-full bg-white/70/60 animate-pulse" />
        </div>
      </footer>
    </div>
   );
 }

 function HangmanDrawing({ wrongCount }: { wrongCount: number }) {
   const parts = Math.min(wrongCount, MAX_ERRORS);
   const dead = parts >= MAX_ERRORS;

   return (
     <div className="flex justify-center md:justify-start">
       <svg
         viewBox="0 0 260 240"
         className="w-full max-w-[380px] md:max-w-[480px] h-auto"
         strokeLinecap="round"
         strokeLinejoin="round"
       >
         <defs>
           <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
             <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#000" floodOpacity="0.15" />
           </filter>
           <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1">
             <stop offset="0%" stopColor="#9A6B3F" />
             <stop offset="100%" stopColor="#6B4423" />
           </linearGradient>
         </defs>

         {/* Chão */}
         <path d="M20 220 Q130 210 240 220" fill="none" stroke="#94a3b8" strokeWidth="4" filter="url(#shadow)" />

         {/* Base e poste (madeira) */}
         <line x1="30" y1="215" x2="170" y2="215" stroke="url(#wood)" strokeWidth="12" filter="url(#shadow)" />
         <line x1="70" y1="215" x2="70" y2="25" stroke="url(#wood)" strokeWidth="12" filter="url(#shadow)" />
         <line x1="70" y1="25" x2="180" y2="25" stroke="url(#wood)" strokeWidth="12" filter="url(#shadow)" />
         {/* Reforço diagonal */}
         <line x1="70" y1="70" x2="115" y2="25" stroke="url(#wood)" strokeWidth="8" />

         {/* Corda e nó */}
         <line x1="180" y1="25" x2="180" y2="52" stroke="#a16207" strokeWidth="6" />
         <ellipse cx="180" cy="56" rx="6" ry="4" fill="none" stroke="#a16207" strokeWidth="4" />

         {/* Partes do boneco (vermelho) */}
         {/* Cabeça */}
         {parts > 0 && <circle cx="180" cy="76" r="18" stroke="#ef4444" strokeWidth="5" fill="none" />}
         {/* Tronco */}
         {parts > 1 && <line x1="180" y1="94" x2="180" y2="138" stroke="#ef4444" strokeWidth="5" />}
         {/* Braço esq */}
         {parts > 2 && <line x1="180" y1="108" x2="152" y2="124" stroke="#ef4444" strokeWidth="5" />}
         {/* Braço dir */}
         {parts > 3 && <line x1="180" y1="108" x2="208" y2="124" stroke="#ef4444" strokeWidth="5" />}
         {/* Perna esq */}
         {parts > 4 && <line x1="180" y1="138" x2="162" y2="170" stroke="#ef4444" strokeWidth="5" />}
         {/* Perna dir */}
         {parts > 5 && <line x1="180" y1="138" x2="198" y2="170" stroke="#ef4444" strokeWidth="5" />}

         {/* Rosto (varia com erros) */}
         {parts > 0 && !dead && (
           <g stroke="#ef4444" strokeWidth="3">
             {/* Olhos */}
             <circle cx="173" cy="72" r="2.5" fill="#ef4444" />
             <circle cx="187" cy="72" r="2.5" fill="#ef4444" />
             {/* Boca neutra levemente curva */}
             <path d="M172 82 Q180 86 188 82" fill="none" />
           </g>
         )}
         {parts > 0 && dead && (
           <g stroke="#ef4444" strokeWidth="3">
             {/* Olhos em X */}
             <line x1="170" y1="70" x2="176" y2="74" />
             <line x1="176" y1="70" x2="170" y2="74" />
             <line x1="184" y1="70" x2="190" y2="74" />
             <line x1="190" y1="70" x2="184" y2="74" />
             {/* Boca triste */}
             <path d="M172 86 Q180 80 188 86" fill="none" />
           </g>
         )}
       </svg>
     </div>
   );
 }
