## Novas funcionalidades

Vou adicionar 3 áreas novas no app, acessíveis pelo menu lateral autenticado.

### 1. Dashboard (`/dashboard`)
Página inicial pós-login com visão consolidada:
- **Cards de resumo**: Patrimônio total da carteira (qtd × preço atual), variação do dia, Nº de opções abertas, Prêmio total em aberto (a receber), Resultado realizado no mês atual.
- **Gráfico de Resultado mensal** (barras): lucro/prejuízo por mês dos últimos 12 meses, baseado em opções com `status = ENCERRADA` ou `EXERCIDA`, agrupadas pela `exit_date` (ou `expiration_date` quando não houver exit).
- **Top posições da carteira** (tabela compacta): ticker, qtd, PM, preço atual, % no portfólio.
- **Opções vencendo nos próximos 30 dias**.

### 2. Resultado Mensal / DARF (`/darf`)
Página dedicada ao cálculo de imposto sobre opções (mercado brasileiro):
- Seletor de mês/ano.
- Lista de operações encerradas no mês (agrupadas pela data de fechamento — `exit_date` se preenchida, senão `expiration_date` quando `status != ABERTA`).
- Resumo do mês:
  - Total de prêmios recebidos
  - Total de custos de recompra
  - **Resultado líquido do mês**
  - Prejuízo acumulado de meses anteriores (compensável)
  - Base de cálculo
  - **DARF a pagar** = 15% sobre base positiva (alíquota padrão de operações comuns com opções; day trade fica fora do MVP)
  - Aviso se valor < R$ 10,00 (não recolhe, acumula)
- Botão "Copiar resumo" para colar na declaração.

### 3. Histórico de Movimentações (`/movimentacoes`)
Página com todas as linhas de `stock_movements` + opções encerradas:
- Filtros: ticker, período (datepicker), tipo de evento.
- Tabela ordenada por data desc: Data, Ticker, Tipo (COMPRA/VENDA/EXERCÍCIO/PRÊMIO CALL/PRÊMIO PUT), Quantidade, Preço, Valor total, Origem.
- Opções encerradas aparecem como linhas sintéticas com tipo "PRÊMIO CALL/PUT" e valor = prêmio líquido.
- Exportar CSV.

### 4. Navegação
Adicionar links no shell autenticado: Dashboard · Carteira · Calls · Puts · DARF · Movimentações.
Tornar `/dashboard` a rota padrão pós-login (em vez de `/carteira`).

### Aspectos técnicos
- Sem mudanças de schema — tudo derivado de `options` e `stock_movements`.
- Cálculos client-side com helpers novos em `src/lib/results-utils.ts` (resultado por opção, agregação mensal, compensação de prejuízo).
- Queries via TanStack Query, com `queryKey` por mês para o DARF.
- Gráfico com `recharts` (já instalado pelo shadcn chart).

### Fora do escopo deste passo
- Day trade separado, IR sobre ações (>R$ 20k/mês), dividendos/JCP, exportação PDF da DARF, edição inline de movimentações.
