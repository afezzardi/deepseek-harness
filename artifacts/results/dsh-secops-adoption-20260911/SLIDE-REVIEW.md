# Revisione dei deck sugli agenti e DeepSeek Harness

## Sintesi

I deck contengono buone domande architetturali, ma mescolano principi, risultati di esperimenti specifici, esempi incompleti e garanzie di prodotto. Il secondo deck migliora alcune attribuzioni del primo, ma una sua correzione principale è errata: i costi $9/$200 esistono in un diverso articolo Anthropic. Nessuno dei due è una specifica pronta da implementare.

Questa revisione copre testo e note delle 22 slide di [Production-Ready-AI-Agents-2026.pptx](../../tmp/Production-Ready-AI-Agents-2026.pptx), indicato con **P**, e delle 34 slide di [AgentiEnterprise_DeepSeekHarness.pptx](../../tmp/AgentiEnterprise_DeepSeekHarness.pptx), indicato con **D**. La verifica DSH si riferisce al checkout `77b16a8`; i dati di deployment conservano la data e il perimetro dei loro report. I deck originali non sono stati modificati.

Il [percorso applicativo](REPORT.md) è la proposta conseguente: SDK + PTC come candidato principale per SecOps avanzato, skill e conoscenza aziendale, tool InspectX componibili e qualità del risultato come criterio di selezione.

## Indice

- [Correzioni che cambiano una decisione](#correzioni-che-cambiano-una-decisione)
- [Numeri, fonti e generalizzazioni](#numeri-fonti-e-generalizzazioni)
- [Concetti da mantenere con condizioni esplicite](#concetti-da-mantenere-con-condizioni-esplicite)
- [Mappa di copertura delle slide](#mappa-di-copertura-delle-slide)
- [Fonti esterne](#fonti-esterne)

## Correzioni che cambiano una decisione

| Slide | Affermazione | Verdetto e formulazione corretta |
|---|---|---|
| P2; D2 | “$9/20 minuti contro $200/6 ore”: il secondo deck dice che l’esperimento non esiste | **La smentita è errata.** La tabella compare in *Harness design for long-running application development*, 24 marzo 2026. È un confronto illustrativo solo/full harness su un game maker con Opus 4.5. L’altro articolo, *Effective harnesses*, è una fonte diversa. Non è una legge sul ROI degli harness e non dimostra che qualunque scaffolding migliori qualunque modello [E1] |
| P1–4; D3 | “L’affidabilità non arriva dal modello” | **Assoluto scorretto.** Modello, tool, conoscenza, dati, scaffolding e ambiente contribuiscono insieme. Lo stesso articolo descrive miglioramenti del modello che consentono di rimuovere parte dello scaffolding. Per il Qwen self-hosted vanno misurate sia capacità analitiche sia code/tool calling [E1] |
| D8 | `ctx.approval` non ha implementazioni shipped, quindi HITL è sempre codice da scrivere | **Fuorviante.** Il servizio ha logica concreta; gli answerer sono listener. Esistono [UI Web](../../../packages/client/ui-approval/README.md) e [bridge ACP](../../../packages/acp/acp/src/index.ts). Il [servizio](../../../packages/interaction/user-approval/README.md) da solo non presenta UI e l’SDK non ha il dialogo bidirezionale completo. La capacità dipende dal canale e dalla composizione |
| D7,13 | Hot reload implica revoca di policy senza redeploy | **Condizionale.** I template `sdk`, `headless`, `sdk-minimal`, `acp` caricano patch a startup; `web` è live. Preset già utilizzati da sessioni mantengono la loro composizione. Servono un controllo dinamico esplicito o un nuovo processo, secondo la policy. Vedi [architettura](../../../docs/architecture.md) e [preset](../../../packages/preset/agent-presets/README.md) |
| D15 | Ledger idempotente con `hash(sessionId, toolCallId)` | **Insufficiente per l’effetto di business.** La chiave identifica un tentativo registrato, non la stessa operazione riproposta in una nuova chiamata/sessione. La chiave deve derivare dall’intento applicativo, con scope, versione e payload coerente; il sistema remoto deve supportare deduplica o riconciliazione. L’inserimento `inflight` deve essere atomico tra concorrenti |
| D15 | Lo snippet ledger usa `def.sideEffecting` e garantisce che il dispatch non parta due volte | **Non è codice pronto.** `sideEffecting` non fa parte della [ToolDefinition corrente](../../../packages/core/tools/src/index.ts). Lookup e marcatura separati non impediscono race. Crash tra effetto remoto e commit locale resta ambiguo; registrare un risultato non prova la transazione remota. La classificazione read/write e il protocollo di deduplica vanno implementati |
| D16 | Lo snippet WeakMap implementa budget token/spesa | **Incompleto.** Non salva il budget nella mappa e non aggiorna i consumi; non implementa spesa, persistenza o riserva. `step` parte da 1, quindi `step >= maxStepsPerTurn` impedisce anche il passo N se N è inteso come numero consentito. Il punto di innesto esiste, la policy mostrata no |
| D9,16 | `agent/turn-stopping` basta per limitare runaway | **Non è un guard universale.** Il [loop](../../../packages/core/agent-loop/src/agent.ts) lo chiama quando esiste un esito terminale di step e non c’è input next-step pendente; non è la barriera eseguita a ogni richiesta. `pre-step` ammette i passi; retry e richieste ausiliarie richiedono accounting appropriato. `reject` produce `turn/end` blocked, non un successo |
| D13,18 | Sicurezza/safety/ASI02/ASI05 “coperti” | **Capacità disponibili, copertura non dimostrata.** I controlli dipendono da profilo, tool e ambiente. Questo non esclude DSH: obbliga a descrivere la composizione realmente scelta invece di una checkbox generale |
| P12; omissione in D28–31 | Code execution implica sandbox; il confronto di modalità ignora il runtime PTC | **Distinzione necessaria.** Il [worker PTC](../../../packages/code-runtime/code-runtime-worker-thread/README.md) limita risorse ma ha accesso Node all’host. Un deployment protetto può fornirgli l’isolamento necessario: ciò consente di scegliere PTC per le capacità analitiche senza attribuire isolamento al thread |
| D18 | ASI06 “coperto” perché log append-only e assenza di memoria semantica auto-scrivente | **Errato.** Contenuto avvelenato può essere conservato, compattato e riletto nel contesto. L’append-only preserva i dati, non la loro attendibilità. OWASP include esplicitamente memory **e context** poisoning [E7] |
| P19; D29 | Log append-only con invarianti equivale a audit inviolabile | **Non dimostrato.** Ordinamento, ricostruibilità e checksum non sono autenticità crittografica o storage WORM. Un soggetto con accesso ai file può alterarli. Le prove richieste dipendono dall’uso del dossier |
| D22,32 | Senza tracing non si può ricostruire un errore né costruire dataset | **Contraddetto dalla stessa architettura.** Session log, risultati e replay possono supportare diagnosi ed estrazione; una piattaforma tracing rende l’operazione più efficace. Assenza di span OTLP nativi non equivale ad assenza di osservabilità. Vedi [persistenza](../../../packages/session/session-persistence-jsonl/README.md) |
| D23 | Plugin tracing “già in produzione” e osservazione fuori dal percorso caldo | **Prima parte non attestata; seconda troppo forte.** Il [handoff](../../plugins/gh-genai-traces/HANDOFF.md) separa validazione e deployment pending. Export detached non implica costo zero di mapping, redazione, serializzazione e code. Non sono state misurate qui latenza o durabilità operative |
| D28 | Il client SDK protegge il servizio quando il runtime muore | **Utile isolamento di processo, non garanzia totale.** Gli errori devono essere gestiti; memoria/CPU possono essere condivise a livello host. Mancano cancellazione per prompt e richieste bidirezionali complete. `run()` restituisce un intervallo receipt-to-idle, non una transazione di business [SDK](../../../packages/sdk/client/README.md) |
| D28 | Headless/SDK/ACP/Web esauriscono la scelta del runtime | **Manca un asse.** Sono superfici di avvio/controllo; native/PTC/both sono presentazioni dei tool. Un agente SDK può usare PTC, skill, knowledge retrieval e subagenti nella stessa composizione |
| D28 | Web non è una modalità d’integrazione | **Troppo assoluto.** Non è il client stdio per il servizio, ma offre una UI e API Remote proprie. Può essere un’interfaccia operativa se adatta al workflow; richiede gestione e compatibilità del relativo stack |
| D19,32 | Ogni processo deve stare in un motore durevole, senza eccezioni per job piccoli | **Prescrizione eccessiva.** Un’analisi rilanciabile può usare un worker supervisionato e stato persistito. Attese, scheduling, retry distribuiti e compensazioni possono giustificare un motore dedicato. Lo richiedono le garanzie del caso, non il nome “agente” [E8] |
| D29 | Goal/todo/log sostituiscono automaticamente feature list e progress file | **Analogia parziale.** Un record di obiettivo non è la prova che un controllo di dominio sia soddisfatto. Un log lungo non è un handoff selezionato. Mantenere criteri di successo e stato dell’indagine espliciti; non duplicare il dato senza motivo |
| D29 | Hook PostToolUse → commit per feature | **Da progettare.** PostToolUse non identifica una feature completa o verificata. Un hook può registrare/eseguire una policy, non dedurre correttezza dal solo completamento del tool. Per SecOps un commit Git non è il risultato di business |
| D1,6,11,32,34 | Branch vecchio, product tree senza modifiche, deployment attuale già verificato | **Obsoleto.** Il checkout è `master` dopo PR #1; il merge include correzioni autorizzate fuori da `artifacts/`. I risultati del 5/9 settembre restano evidenza dei rispettivi run, non della composizione attuale. [Stato](../../NEXT-SESSION.md) |
| D31,34 | DSH migliore di qualunque alternativa open source sui tre assi indicati | **Giudizio non misurato.** Non è presentato un benchmark comparabile. La scelta può essere giustificata da composizione, modello self-hosted e investimento nel fork, senza una superiorità universale |

### Che cosa comporta per la nostra implementazione

Gli snippet delle slide 15–16 non vanno trasformati direttamente in backlog “due plugin in una settimana”. Il primo workload InspectX è analitico: la priorità è consentire query e correlazioni ricche, insegnare il dominio e validare i dossier. Ledger per scritture Fortinet e compensazioni non sono prerequisiti di un agente che non effettua quelle scritture.

PTC merita una prova immediata sul caso avanzato. Il controllo nativo rimane essenziale nell’evaluation per verificare se i programmi migliorano la qualità, non perché debba essere la prima soluzione in produzione. Il contenimento viene fornito dall’ambiente previsto per il job.

## Numeri, fonti e generalizzazioni

| Slide | Numero o regola | Verifica e uso corretto |
|---|---|---|
| P3; D2,4 | 88% infrastruttura; 31,6/30,3/24,9/8,1/5,1% | La pagina Clyro descrive 591 incidenti e una classificazione per keyword, non revisione esperta individuale. La categoria context blindness è indicata come mista modello/infrastruttura. Non dimostra la distribuzione dei nostri guasti né che cambiare modello non aiuti [E3] |
| D2; P17 | Errori infrastrutturali 5,8→2,1%; gap 6 punti; headroom 3× | Sono misure distinte in esperimenti Terminal-Bench. 3× non è una raccomandazione universale per il servizio SecOps; vanno misurate le risorse del job e dell’inferenza [E4] |
| P8 | Costo multi-turn cresce 3–5× rispetto alla stima ingenua | **Non dimostrato come fattore generale.** Crescita della storia, caching, compaction, output e prezzi/risorse determinano il costo. Misurare richieste e token effettivi, non dimensionare con questo moltiplicatore |
| P12 | 150.000→2.000 token, −98,7% | Dato presente nel caso MCP di Anthropic. Descrive il vantaggio di caricamento on-demand e code execution in quel caso, non un risparmio previsto di PTC su InspectX. Il guadagno di qualità da composizione può contare più del risparmio [E5] |
| P17; D25,33 | Almeno 500 casi prima di fidarsi di qualsiasi aggregato | **Non è una soglia universale.** Anthropic suggerisce iniziare con 20–50 casi. Il campione necessario dipende da rischio, frequenza dei guasti e precisione desiderata; 500 casi correlati non valgono 500 casi indipendenti [E2] |
| P17 | Gate al 95%; Pearson ≥0,8; scala 0–5 sempre migliore | **Scelte non giustificate come standard.** Definire metriche per finding e categorie critiche. Correlazione non è accordo e può restare alta con bias sistematico. Una media non deve nascondere errori gravi |
| P17; D26 | 0,75³≈0,42 | Aritmetica corretta sotto probabilità uguale e prove indipendenti. Task eterogenei o un ambiente condiviso violano questa semplificazione; misurare per classe e riportare variabilità [E2] |
| P17; D26 | CORE-Bench 42→95, quindi pass@100 zero di solito è un grader rotto | Il caso è riportato da Anthropic con problemi di grading, specifiche e scaffold. Non dimostra che un modello locale non possa essere incapace su un task. Usarlo come invito a controllare task e grader, non per ignorare un limite di capacità [E2] |
| P18 | Prompt mai come attributi: sempre span event | **Non è una regola universale OTel.** La documentazione contempla `gen_ai.input.messages` su eventi e span, con requisiti di formato. Raccolta contenuti, redazione e limiti dipendono dalla policy e dal backend; pin della convenzione appropriato [E6] |
| P18 | Sampling tutti gli errori/10% successi, retention 30–90 giorni/1 anno, overhead <1 ms | **Non sono garanzie della specifica.** Sono possibili scelte di deployment da motivare e misurare; retention dipende anche dalle esigenze dei dati. Sampling e truncation influenzano la completezza dell’evaluation |
| D4 | Gravitee: 82/88/21% e API key condivise | La fonte primaria conferma 82% fiducia nelle policy, 88% incidenti **confermati o sospetti**, 45,6% shared API key e 21,9% identità indipendenti. La formulazione “21% visibilità runtime” richiede il punto preciso del report, non è corroborata dall’articolo consultato. La landing ha edizioni aggiornate: citare data, campione e domanda [E9] |
| D4,18,30 | Arkose 97%, Google +32%, budget Uber esaurito ad aprile | Non verificati con fonte primaria pertinente in questa analisi. Non sono necessari alla decisione tecnica: rimuoverli dal ragionamento d’investimento finché non sono corredati da fonte, data, definizione e perimetro |
| D20 | Multi-agent +90% | Anthropic riporta +90,2% in un eval interno di ricerca, con modelli e task definiti. Riporta anche consumo elevato. Non generalizzarlo a qualunque squadra SecOps; valutare lead contro lead+specialisti sul nostro set [E10] |
| D24–25 | 48 task, 144 trial, 300 target; split 223/40/37 | Confermati dai [report del fork](../fireworks-sft-20260909/REPORT.md) e dal [handoff](../../plugins/gh-genai-traces/HANDOFF.md). Sono evidenza della pipeline sintetica; non qualità SecOps e non 300 esempi indipendenti |
| D24 | Preview 446/446 e validation 80/80 | I report conservano questi confronti e distinguono il recheck dagli errori remoti della validazione batched originale. Non equivalgono a parità dei token del trainer o qualità della policy servita |
| D25 | DPO impossibile senza coppie pass/fail identiche | La campagna non ha le coppie richieste dall’export corrente. DPO richiede risposte confrontabili sotto lo stesso input e preferenze valide, non necessariamente un binario pass/fail naturale. Mancanza nel dataset presente non è impossibilità generale; training resta differito |
| D30 | Stripe ~1.300 PR, tutti umanamente revisionati | La fonte primaria consultata parla di oltre mille PR merged a settimana e revisione umana. Il pattern blueprint è pertinente; il numero esatto 1.300 richiede la fonte/revisione specifica. Non trasformare throughput di coding in stima del workload SecOps [E11] |
| D30 | Anthropic/Material 86% coding, 57% workflow multistadio | Presenti nel report, con campione della survey. Descrivono gli intervistati e adozione dichiarata, non efficacia, sicurezza o tutte le aziende [E12] |
| D31 | Mastra durevole solo tramite adapter esterno; classifiche “stabile” | La documentazione attuale descrive snapshot persistiti e suspend/resume attraverso storage. La tabella comprime livelli diversi: storage adapter, checkpoint, motore distribuito e retry non sono la stessa capacità. Le etichette di maturità non sono test comparativi [E13] |

## Concetti da mantenere con condizioni esplicite

**Stato e memoria.** È corretto distinguere stato dell’indagine da contesto del modello. Non ne segue che tutta la conversazione sia eliminabile: in DSH il log include richieste e risultati strutturati utili alla ricostruzione. Anche un dato richiamabile dalla fonte può cambiare o sparire; conservare evidenze e provenienza secondo il caso.

**Idempotenza ed esecuzione durevole.** At-least-once più operazione idempotente può fornire un effetto osservabile una volta nelle condizioni previste. Occorrono identità stabile, concorrenza controllata, transazioni/deduplica e gestione dell’intervallo incerto. Una saga compensa operazioni definite; non annulla qualsiasi effetto irreversibile [E8].

**Policy fuori dal modello.** Principio corretto. Non significa che il modello non possa cambiare internamente idea dopo un contenuto malevolo; significa che gli effetti ammissibili sono limitati e verificati indipendentemente. “Impossibile cambiare goal” è una garanzia più forte di quanto forniscano prompt, classifier o sandbox.

**Context engineering.** Compaction, retrieval e selezione delle evidenze sono utili. La sintesi può perdere dettagli; la presenza di un prefisso comune consente ma non garantisce cache hit: provider, template, scheduling ed eviction contano. Per SecOps il criterio è conservare le prove necessarie al finding, non minimizzare sempre i token.

**Cancellation.** Il segnale deve arrivare al lavoro posseduto, ma l’annullamento non prova che il server remoto non abbia già eseguito qualcosa. DSH documenta cancellazione cooperativa dei tool in-process; il job isolato deve possedere anche il teardown dei processi. Nel caso InspectX l’esito remoto può richiedere riconciliazione.

**Replay ed evaluation.** Replay di risposte fissate e valutazione di capacità del modello sono due prove diverse. Ricostruire una richiesta non ripristina la rete nello stato storico né riproduce automaticamente ogni effetto esterno. Outcome e provenienza devono essere verificati con dati e oracle del dominio.

**Compliance.** La nota P19 richiama correttamente l’articolo 14 per sistemi AI ad alto rischio. Non rende automaticamente ogni assistente SecOps un sistema ad alto rischio, né impone di approvare manualmente ogni lettura. Applicabilità e obblighi richiedono classificazione del caso; il deck non la fornisce [E14].

**Multi-agent.** Task indipendenti possono beneficiare di specialisti; task accoppiati richiedono coordinamento. “Mai scritture concorrenti senza lock” è troppo prescrittivo: isolamento, transazioni, versioni e operazioni commutative sono altre strategie. La decisione per SecOps dipende dal miglioramento delle indagini, non dall’adozione di un pattern di moda.

## Mappa di copertura delle slide

| Deck e slide | Esito |
|---|---|
| P1–4 | Tesi utile; assoluti su modello e attribuzioni numeriche da correggere |
| P5 | Indice, nessuna capacità da verificare |
| P6–9 | Distinzioni utili su stato/contratti; exactly-once, costo e structured output richiedono condizioni |
| P10–13 | Controlli e responsabilità sensati; non universali e non prova di assenza di injection |
| P14 | Indice |
| P15–17 | Evaluation da conservare; soglie universali da rimuovere, metriche da contestualizzare |
| P18–19 | Tracing e governance utili; formati, retention, overhead e applicabilità normativa da precisare |
| P20–22 | Roadmap utile come schema; criteri tarati sul workload, non su piattaforma obbligatoria |
| D1–4 | Riferimenti di revisione da aggiornare; correggere la falsa smentita dei costi e qualificare survey |
| D5 | Separatore |
| D6–10 | Composizione Cordis e pipeline sostanzialmente utili; approvazioni, hot reload e budget precisati |
| D11 | Configurazioni e misure storiche, non stato operativo corrente |
| D12 | Separatore |
| D13–18 | Sostituire “coperto” con capacità e prova richiesta; non copiare gli snippet; memoria e PTC distinti |
| D19–20 | Stato/esecuzione e delega ben motivati; orchestratore non obbligatorio, prestazioni contestuali |
| D21 | Separatore |
| D22–26 | Distinguere log/tracing/deployment/dataset/eval; numeri interni confermati nel loro perimetro |
| D27 | Separatore |
| D28–29 | SDK utile; aggiungere PTC, skill/KB e limiti di protocollo; analogie non sono implementazioni |
| D30–32 | Casi di mercato non provano superiorità; tabella vendor e stato fork da qualificare |
| D33–34 | Roadmap da rifare sulla verticale SecOps e qualità; tempi, ≥500 casi e motore obbligatorio non giustificati |

## Fonti esterne

Le fonti locali sono collegate nelle singole correzioni. Le pagine esterne sono state consultate il 11 settembre 2026; dove una pagina cambia nel tempo, titolo e data dell’articolo prevalgono su una landing generica.

- **E1.** Anthropic, Prithvi Rajasekaran, [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps), 24 marzo 2026. Tabella costi, modelli e revisione dello scaffolding. Distinto da [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents).
- **E2.** Anthropic, [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents), 2026. Metriche, campioni iniziali, qualità dei grader e caso CORE-Bench.
- **E3.** Clyro, [We Analyzed 100 AI Agent Failures](https://clyro.dev/blog/we-analyzed-100-ai-agent-failures), dataset dichiarato 2023–2026 e limiti della classificazione.
- **E4.** Anthropic, [Quantifying infrastructure noise in agentic coding evals](https://www.anthropic.com/engineering/infrastructure-noise), dati Terminal-Bench su headroom e score.
- **E5.** Anthropic, [Code execution with MCP: building more efficient AI agents](https://www.anthropic.com/engineering/code-execution-with-mcp), esempio 150.000→2.000 token.
- **E6.** OpenTelemetry, [GenAI attributes](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/), specifiche di `gen_ai.input.messages` e distinzione eventi/span; la documentazione segnala il trasferimento al repository delle convenzioni GenAI.
- **E7.** OWASP, Idan Habler, [Memory Is a Feature. It Is Also an Attack Surface](https://genai.owasp.org/2026/05/13/memory-is-a-feature-it-is-also-an-attack-surface), 13 maggio 2026.
- **E8.** Temporal, [Saga pattern](https://docs.temporal.io/design-patterns/saga-pattern); LangGraph, [Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api) e [Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts), condizioni di replay/idempotenza.
- **E9.** Gravitee, Jorge Ruiz, [State of AI Agent Security 2026 Report: When Adoption Outpaces Control](https://www.gravitee.io/blog/state-of-ai-agent-security-2026-report-when-adoption-outpaces-control), 4 febbraio 2026; [landing del report](https://www.gravitee.io/state-of-ai-agent-security), contenuti aggiornati e confronto temporale.
- **E10.** Anthropic, [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system), eval interno e trade-off di consumo.
- **E11.** Stripe, Alistair Gray, [Minions: Stripe’s one-shot, end-to-end coding agents](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents), 9 febbraio 2026; [Part 2](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2), 19 febbraio 2026.
- **E12.** Anthropic/Material, [The 2026 State of AI Agents Report](https://resources.anthropic.com/hubfs/The%202026%20State%20of%20AI%20Agents%20Report.pdf), survey, adozione dichiarata e metodologia.
- **E13.** Mastra, [Storage](https://mastra.ai/docs/storage) e [Agent lifecycle](https://mastra.ai/docs/guides/agent-lifecycle), documentazione corrente su snapshot, suspend/resume e storage.
- **E14.** Unione europea, [Regolamento (UE) 2024/1689](https://eur-lex.europa.eu/legal-content/EN/TXT/PDF?uri=OJ%3AL_202401689), articolo 14. Citato solo per il perimetro della frase nelle note del deck, non per una classificazione normativa di questo progetto.
