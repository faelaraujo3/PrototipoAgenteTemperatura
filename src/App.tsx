import { useState, useEffect, useRef, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PerceptionRecord {
  cycle: number
  Ta: number
  Td: number
  state: 'on' | 'off'
  action: string
  Ti: number | null
  deltaT: number | null
  time: string
}

interface ThermalEpisode {
  type: 'cooling' | 'heating'
  Ti: number
  Td: number
  startCycle: number
  endCycle: number
  deltaT: number
  rate: number
}

interface CurrentEpisode {
  type: 'cooling' | 'heating'
  Ti: number
  startCycle: number
}

interface ChartPoint {
  cycle: number
  Ta: number
  Td: number
  limit: number
}

interface AgentState {
  Ta: number
  Td: number
  systemOn: boolean
  waitTime: number
  cycle: number
  observedTemps: number[]
  sigma: number
  limit: number
  memory: PerceptionRecord[]
  history: string[]
  episodes: ThermalEpisode[]
  currentEpisode: CurrentEpisode | null
  chartData: ChartPoint[]
  lastDecision: string
  lastExplanation: string
  explanationType: 'info' | 'warn' | 'success' | 'danger'
  avgCoolingRate: number | null
  avgHeatingRate: number | null
  coolingCount: number
  heatingCount: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const INITIAL_TA = 30
const INITIAL_TD = 25
const DEFAULT_SIGMA = 1.0
const COOLING_RATE_SIM = 0.5  // °C per cycle in simulation
const HEATING_RATE_SIM = 0.3  // °C per cycle (natural)

// ─── Helper functions ─────────────────────────────────────────────────────────

function calcSigma(temps: number[]): number {
  if (temps.length < 2) return DEFAULT_SIGMA
  const mean = temps.reduce((a, b) => a + b, 0) / temps.length
  const variance = temps.reduce((acc, t) => acc + (t - mean) ** 2, 0) / temps.length
  return Math.max(0.3, Math.sqrt(variance))
}

function getTimeStr(): string {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function fmt(t: number): string {
  return `${t.toFixed(1)} °C`
}

function simulateTemp(Ta: number, Td: number, systemOn: boolean): number {
  if (systemOn) {
    const noise = Math.random() * 0.15 - 0.075
    const next = Ta - COOLING_RATE_SIM + noise
    return parseFloat(Math.max(Td - 2, next).toFixed(1))
  }
  if (Ta < Td - 0.4) {
    const noise = Math.random() * 0.1 - 0.05
    const next = Ta + HEATING_RATE_SIM + noise
    return parseFloat(Math.min(Td + 5, next).toFixed(1))
  }
  // Near Td: small random variation simulating imperfect environment
  const variation = Math.random() * 0.3 - 0.1
  return parseFloat((Ta + variation).toFixed(1))
}

function buildInitialState(Ta: number, Td: number): AgentState {
  const sigma = DEFAULT_SIGMA
  const limit = parseFloat((Td + 3 * sigma).toFixed(2))
  return {
    Ta,
    Td,
    systemOn: false,
    waitTime: 0,
    cycle: 0,
    observedTemps: [],
    sigma,
    limit,
    memory: [],
    history: [
      `[${getTimeStr()}] Agente iniciado. Ta = ${fmt(Ta)}, Td = ${fmt(Td)}, Sistema = DESLIGADO, σ padrão = ${sigma.toFixed(2)}, Limite = ${fmt(limit)}`,
    ],
    episodes: [],
    currentEpisode: null,
    chartData: [{ cycle: 0, Ta, Td, limit }],
    lastDecision: '—',
    lastExplanation: 'Simulação não iniciada. Clique em INICIAR SIMULAÇÃO ou AVANÇAR 1 CICLO.',
    explanationType: 'info',
    avgCoolingRate: null,
    avgHeatingRate: null,
    coolingCount: 0,
    heatingCount: 0,
  }
}

// ─── Core agent logic (one cycle) ─────────────────────────────────────────────

function agentCycle(prev: AgentState): AgentState {
  const s = { ...prev }
  const t = getTimeStr()
  const newCycle = s.cycle + 1

  // ── Rule 1: if waiting, don't perceive ──────────────────────────────────────
  if (s.waitTime > 0) {
    const newTa = simulateTemp(s.Ta, s.Td, s.systemOn)
    const newWait = s.waitTime - 1
    const newObserved = [...s.observedTemps, newTa]
    const newSigma = calcSigma(newObserved)
    const newLimit = parseFloat((s.Td + 3 * newSigma).toFixed(2))

    let episodes = [...s.episodes]
    let currentEp = s.currentEpisode
    let avgCoolingRate = s.avgCoolingRate
    let avgHeatingRate = s.avgHeatingRate
    let coolingCount = s.coolingCount
    let heatingCount = s.heatingCount
    const logs: string[] = []

    // Check if temperature reached target during wait
    if (currentEp) {
      const reached =
        (currentEp.type === 'cooling' && newTa <= s.Td) ||
        (currentEp.type === 'heating' && newTa >= s.Td - 0.2)
      if (reached) {
        const deltaT = newCycle - currentEp.startCycle
        const rate =
          currentEp.type === 'cooling'
            ? Math.max(0.01, (currentEp.Ti - s.Td) / deltaT)
            : Math.max(0.01, (s.Td - currentEp.Ti) / deltaT)
        const ep: ThermalEpisode = {
          type: currentEp.type,
          Ti: currentEp.Ti,
          Td: s.Td,
          startCycle: currentEp.startCycle,
          endCycle: newCycle,
          deltaT,
          rate,
        }
        episodes = [ep, ...episodes]
        currentEp = null
        if (ep.type === 'cooling') {
          coolingCount++
          avgCoolingRate = episodes.filter(e => e.type === 'cooling').reduce((acc, e) => acc + e.rate, 0) / coolingCount
          logs.push(`[${t}] Ciclo ${newCycle} (espera): Resfriamento concluído! ΔT = ${deltaT} ciclos | r↓ = ${rate.toFixed(3)} °C/ciclo`)
        } else {
          heatingCount++
          avgHeatingRate = episodes.filter(e => e.type === 'heating').reduce((acc, e) => acc + e.rate, 0) / heatingCount
          logs.push(`[${t}] Ciclo ${newCycle} (espera): Aquecimento concluído! ΔT = ${deltaT} ciclos | r↑ = ${rate.toFixed(3)} °C/ciclo`)
        }
      }
    }

    logs.push(`[${t}] Ciclo ${newCycle}: AGUARDANDO (${newWait} ciclos restantes) — Ta = ${fmt(newTa)}`)

    return {
      ...s,
      Ta: newTa,
      waitTime: newWait,
      cycle: newCycle,
      observedTemps: newObserved,
      sigma: newSigma,
      limit: newLimit,
      history: [...logs, ...s.history],
      episodes,
      currentEpisode: currentEp,
      chartData: [...s.chartData, { cycle: newCycle, Ta: newTa, Td: s.Td, limit: newLimit }],
      avgCoolingRate,
      avgHeatingRate,
      coolingCount,
      heatingCount,
      lastExplanation: `Tempo de espera ainda não terminou (${newWait} restantes). Nenhuma nova percepção será realizada.`,
      explanationType: 'info',
    }
  }

  // ── Rule 2: Perceive ────────────────────────────────────────────────────────
  const Ta = s.Ta
  const Td = s.Td
  const systemOn = s.systemOn

  // ── Rule 3: Store perception context (completed after action) ───────────────
  const newObserved = [...s.observedTemps, Ta]
  const newSigma = calcSigma(newObserved)
  const newLimit = parseFloat((Td + 3 * newSigma).toFixed(2))

  const logs: string[] = [
    `[${t}] ─── Ciclo ${newCycle}: PERCEPÇÃO ───────────────────────`,
    `[${t}] Ta = ${fmt(Ta)} | Td = ${fmt(Td)} | Sistema = ${systemOn ? 'LIGADO' : 'DESLIGADO'}`,
    `[${t}] σ = ${newSigma.toFixed(3)} | L = Td + 3σ = ${Td} + ${(3 * newSigma).toFixed(2)} = ${fmt(newLimit)}`,
  ]

  // ── Rule 4: Consult memory / learning ──────────────────────────────────────
  if (s.avgCoolingRate !== null) {
    logs.push(`[${t}] Memória: taxa média resfriamento = ${s.avgCoolingRate.toFixed(3)} °C/ciclo (${s.coolingCount} episódios)`)
  }
  if (s.avgHeatingRate !== null) {
    logs.push(`[${t}] Memória: taxa média aquecimento = ${s.avgHeatingRate.toFixed(3)} °C/ciclo (${s.heatingCount} episódios)`)
  }

  let episodes = [...s.episodes]
  let currentEp = s.currentEpisode ? { ...s.currentEpisode } : null
  let avgCoolingRate = s.avgCoolingRate
  let avgHeatingRate = s.avgHeatingRate
  let coolingCount = s.coolingCount
  let heatingCount = s.heatingCount
  let newSystemOn = systemOn

  let action = ''
  let decision = ''
  let explanation = ''
  let explanationType: AgentState['explanationType'] = 'info'
  let updatedMemory = [...s.memory]

  // ── Rules 9 & 10: Decision ─────────────────────────────────────────────────
  if (Ta > newLimit) {
    // Temperature above limit → cooling needed
    if (!systemOn) {
      // Rule 9: Turn on
      action = 'Ligou resfriamento'
      decision = 'LIGAR RESFRIAMENTO'
      explanation = `Ta = ${fmt(Ta)} > Limite = ${fmt(newLimit)} → Temperatura acima do limite. Sistema será ligado.`
      explanationType = 'danger'
      newSystemOn = true

      // Rule 5: Start cooling episode
      currentEp = { type: 'cooling', Ti: Ta, startCycle: newCycle }
      logs.push(`[${t}] Ta (${Ta.toFixed(1)}) > L (${newLimit.toFixed(1)}) → LIGAR RESFRIAMENTO`)
      logs.push(`[${t}] Episódio de resfriamento iniciado. Ti = ${fmt(Ta)}`)
    } else {
      action = 'Manter resfriamento ligado'
      decision = 'MANTER LIGADO'
      explanation = `Ta = ${fmt(Ta)} > Limite = ${fmt(newLimit)} → Sistema já ligado. Manter resfriamento ativo.`
      explanationType = 'warn'
      logs.push(`[${t}] Ta (${Ta.toFixed(1)}) > L (${newLimit.toFixed(1)}) → Manter sistema LIGADO`)
    }
  } else {
    // Temperature at or below limit
    if (systemOn) {
      // Rule 10: Turn off
      action = 'Desligou resfriamento'
      decision = 'DESLIGAR RESFRIAMENTO'
      explanation = `Ta = ${fmt(Ta)} ≤ Limite = ${fmt(newLimit)} → Temperatura voltou à faixa aceitável. Desligar sistema.`
      explanationType = 'success'
      newSystemOn = false

      // Rule 6: Close cooling episode and calculate ΔT
      if (currentEp && currentEp.type === 'cooling') {
        const deltaT = newCycle - currentEp.startCycle
        const rate = deltaT > 0 ? Math.max(0.01, (currentEp.Ti - Td) / deltaT) : COOLING_RATE_SIM
        const ep: ThermalEpisode = {
          type: 'cooling',
          Ti: currentEp.Ti,
          Td,
          startCycle: currentEp.startCycle,
          endCycle: newCycle,
          deltaT,
          rate,
        }
        episodes = [ep, ...episodes]
        coolingCount++
        avgCoolingRate = episodes.filter(e => e.type === 'cooling').reduce((a, e) => a + e.rate, 0) / coolingCount
        currentEp = null

        // Update memory record ΔT for the episode
        updatedMemory = updatedMemory.map(m =>
          m.cycle === ep.startCycle ? { ...m, deltaT } : m
        )

        logs.push(`[${t}] Episódio de resfriamento encerrado. ΔT = ${deltaT} ciclos`)
        logs.push(`[${t}] r↓ = (Ti - Td) / ΔT = (${ep.Ti.toFixed(1)} - ${Td}) / ${deltaT} = ${rate.toFixed(3)} °C/ciclo`)
        logs.push(`[${t}] Média r↓ atualizada: ${avgCoolingRate.toFixed(3)} °C/ciclo (${coolingCount} ep.)`)
      }

      logs.push(`[${t}] Ta (${Ta.toFixed(1)}) ≤ L (${newLimit.toFixed(1)}) → DESLIGAR sistema`)
    } else {
      // System is off; check if below Td (heating naturally)
      if (Ta < Td - 0.5) {
        action = 'Manter desligado (aquecendo naturalmente)'
        decision = 'AGUARDAR AQUECIMENTO'
        explanation = `Ta = ${fmt(Ta)} < Td = ${fmt(Td)} → Temperatura abaixo da desejada. Sistema desligado; ambiente aquece naturalmente.`
        explanationType = 'info'

        if (!currentEp || currentEp.type !== 'heating') {
          currentEp = { type: 'heating', Ti: Ta, startCycle: newCycle }
          logs.push(`[${t}] Ta abaixo de Td → aguardando aquecimento natural. Ti = ${fmt(Ta)}`)
        }
      } else {
        // Check if a heating episode finished
        if (currentEp && currentEp.type === 'heating' && Ta >= Td - 0.3) {
          const deltaT = newCycle - currentEp.startCycle
          if (deltaT > 0) {
            const rate = Math.max(0.01, (Td - currentEp.Ti) / deltaT)
            const ep: ThermalEpisode = {
              type: 'heating',
              Ti: currentEp.Ti,
              Td,
              startCycle: currentEp.startCycle,
              endCycle: newCycle,
              deltaT,
              rate,
            }
            episodes = [ep, ...episodes]
            heatingCount++
            avgHeatingRate = episodes.filter(e => e.type === 'heating').reduce((a, e) => a + e.rate, 0) / heatingCount
            currentEp = null
            logs.push(`[${t}] Aquecimento concluído. ΔT = ${deltaT} ciclos | r↑ = ${rate.toFixed(3)} °C/ciclo`)
            logs.push(`[${t}] Média r↑ atualizada: ${avgHeatingRate.toFixed(3)} °C/ciclo (${heatingCount} ep.)`)
          } else {
            currentEp = null
          }
        }

        action = 'Manter desligado'
        decision = 'MANTER DESLIGADO'
        explanation = `Ta = ${fmt(Ta)} ≈ Td = ${fmt(Td)} → Temperatura na faixa desejada. Sistema permanece desligado.`
        explanationType = 'success'
        logs.push(`[${t}] Temperatura na faixa aceitável. Manter sistema DESLIGADO`)
      }
    }
  }

  logs.push(`[${t}] Decisão: ${decision}`)

  // Update temperature simulation
  const newTa = simulateTemp(Ta, Td, newSystemOn)

  // ── Rule 11: Estimate wait time ────────────────────────────────────────────
  let newWaitTime = 0
  if (newSystemOn) {
    if (avgCoolingRate && avgCoolingRate > 0) {
      newWaitTime = Math.max(1, Math.round((newTa - Td) / avgCoolingRate))
      logs.push(`[${t}] Estimativa (aprendida): espera = (${newTa.toFixed(1)} - ${Td}) / ${avgCoolingRate.toFixed(3)} = ${newWaitTime} ciclos`)
    } else {
      newWaitTime = Math.max(1, Math.round((newTa - Td) / COOLING_RATE_SIM))
      logs.push(`[${t}] Estimativa (fallback): espera = (${newTa.toFixed(1)} - ${Td}) / ${COOLING_RATE_SIM} = ${newWaitTime} ciclos`)
    }
  } else if (newTa < Td - 0.5) {
    if (avgHeatingRate && avgHeatingRate > 0) {
      newWaitTime = Math.max(1, Math.round((Td - newTa) / avgHeatingRate))
      logs.push(`[${t}] Estimativa (aprendida): espera = (${Td} - ${newTa.toFixed(1)}) / ${avgHeatingRate.toFixed(3)} = ${newWaitTime} ciclos`)
    } else {
      newWaitTime = Math.max(1, Math.round((Td - newTa) / HEATING_RATE_SIM))
      logs.push(`[${t}] Estimativa (fallback): espera = (${Td} - ${newTa.toFixed(1)}) / ${HEATING_RATE_SIM} = ${newWaitTime} ciclos`)
    }
  }
  if (newWaitTime > 0) {
    logs.push(`[${t}] Próxima percepção após ${newWaitTime} ciclos`)
  }

  // ── Rule 3: Store perception in memory ─────────────────────────────────────
  const record: PerceptionRecord = {
    cycle: newCycle,
    Ta,
    Td,
    state: systemOn ? 'on' : 'off',
    action,
    Ti: currentEp?.Ti ?? s.currentEpisode?.Ti ?? null,
    deltaT: null,
    time: t,
  }
  const newMemory = [record, ...updatedMemory]

  const newChartData = [
    ...s.chartData,
    { cycle: newCycle, Ta: newTa, Td, limit: newLimit },
  ]

  return {
    ...s,
    Ta: newTa,
    Td,
    systemOn: newSystemOn,
    waitTime: newWaitTime,
    cycle: newCycle,
    observedTemps: newObserved,
    sigma: newSigma,
    limit: newLimit,
    memory: newMemory,
    history: [...logs, ...s.history],
    episodes,
    currentEpisode: currentEp,
    chartData: newChartData,
    lastDecision: decision,
    lastExplanation: explanation,
    explanationType,
    avgCoolingRate,
    avgHeatingRate,
    coolingCount,
    heatingCount,
  }
}

// ─── Native SVG chart ─────────────────────────────────────────────────────────
// Recharts loads a separate React runtime in the Make preview, which triggers an
// invalid-hook-call error. This small chart keeps the simulation self-contained.

function TemperatureChart({ data, min, max, desired, limit }: {
  data: ChartPoint[]
  min: number
  max: number
  desired: number
  limit: number
}) {
  const width = 680
  const height = 200
  const pad = { top: 10, right: 58, bottom: 28, left: 44 }
  const innerWidth = width - pad.left - pad.right
  const innerHeight = height - pad.top - pad.bottom
  const low = Math.floor(min)
  const high = Math.ceil(max)
  const range = Math.max(1, high - low)
  const firstCycle = data[0]?.cycle ?? 0
  const lastCycle = data[data.length - 1]?.cycle ?? firstCycle + 1
  const cycleRange = Math.max(1, lastCycle - firstCycle)
  const x = (cycle: number) => pad.left + ((cycle - firstCycle) / cycleRange) * innerWidth
  const y = (temperature: number) => pad.top + ((high - temperature) / range) * innerHeight
  const line = data.map(point => `${x(point.cycle)},${y(point.Ta)}`).join(' ')
  const yTicks = Array.from({ length: 5 }, (_, index) => low + (range * index) / 4)

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Gráfico da evolução da temperatura" style={{ width: '100%', height: '100%', display: 'block', overflow: 'visible' }}>
      {yTicks.map(tick => (
        <g key={tick}>
          <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke="#e2e8f0" strokeDasharray="3 3" />
          <text x={pad.left - 7} y={y(tick) + 3} textAnchor="end" fontSize="9" fill="#94a3b8" fontFamily="DM Mono, monospace">{tick.toFixed(1)}</text>
        </g>
      ))}
      <line x1={pad.left} x2={width - pad.right} y1={y(desired)} y2={y(desired)} stroke="#1d4ed8" strokeDasharray="4 2" strokeWidth="1.5" />
      <line x1={pad.left} x2={width - pad.right} y1={y(limit)} y2={y(limit)} stroke="#dc2626" strokeDasharray="4 2" strokeWidth="1.5" />
      <text x={width - pad.right + 4} y={y(desired) + 3} fontSize="9" fill="#1d4ed8" fontFamily="DM Mono, monospace">Td={desired.toFixed(1)}</text>
      <text x={width - pad.right + 4} y={y(limit) + 3} fontSize="9" fill="#dc2626" fontFamily="DM Mono, monospace">L={limit.toFixed(1)}</text>
      <polyline points={line} fill="none" stroke="#0891b2" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      {data.length > 0 && <circle cx={x(data[data.length - 1].cycle)} cy={y(data[data.length - 1].Ta)} r="3" fill="#0891b2" stroke="white" strokeWidth="1.5" />}
      <text x={pad.left} y={height - 8} fontSize="9" fill="#94a3b8" fontFamily="DM Mono, monospace">{firstCycle}</text>
      <text x={width - pad.right} y={height - 8} textAnchor="end" fontSize="9" fill="#94a3b8" fontFamily="DM Mono, monospace">{lastCycle}</text>
      <text x={width / 2} y={height - 8} textAnchor="middle" fontSize="9" fill="#94a3b8">Ciclo</text>
    </svg>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [inputTa, setInputTa] = useState(INITIAL_TA)
  const [inputTd, setInputTd] = useState(INITIAL_TD)
  const [agent, setAgent] = useState<AgentState>(() => buildInitialState(INITIAL_TA, INITIAL_TD))
  const [isRunning, setIsRunning] = useState(false)
  const [activeTab, setActiveTab] = useState<'memory' | 'episodes'>('memory')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const historyRef = useRef<HTMLDivElement>(null)

  const step = useCallback(() => {
    setAgent(prev => agentCycle(prev))
  }, [])

  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(step, 700)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isRunning, step])

  const handleReset = () => {
    setIsRunning(false)
    setAgent(buildInitialState(inputTa, inputTd))
  }

  const handleApplyParams = () => {
    setIsRunning(false)
    setAgent(buildInitialState(inputTa, inputTd))
  }

  const { Ta, Td, systemOn, waitTime, cycle, limit, sigma,
    memory, history, episodes, chartData,
    lastDecision, lastExplanation, explanationType,
    avgCoolingRate, avgHeatingRate, coolingCount, heatingCount,
    currentEpisode } = agent

  const tempMin = Math.min(Td - 3, ...chartData.slice(-50).map(d => d.Ta)) - 1
  const tempMax = Math.max(Td + 5, ...chartData.slice(-50).map(d => d.Ta)) + 1
  const recentChart = chartData.slice(-60)

  const decisionClass =
    explanationType === 'danger' ? 'decision-box danger'
    : explanationType === 'warn' ? 'decision-box warn'
    : explanationType === 'success' ? 'decision-box success'
    : 'decision-box'

  return (
    <div style={{ minHeight: '100vh', background: '#f0f4f8', padding: '16px' }}>
      {/* ── Header ── */}
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="section-tag">Sistemas Inteligentes</span>
              <span style={{ fontSize: '0.72rem', color: '#64748b', fontFamily: 'DM Mono, monospace' }}>Protótipo Acadêmico</span>
            </div>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#0f172a', margin: '4px 0 0' }}>
              Agente Controlador de Temperatura
            </h1>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {isRunning && <span className="pulse-dot" />}
            <span style={{ fontSize: '0.75rem', color: '#64748b', fontFamily: 'DM Mono, monospace' }}>
              Ciclo: <strong style={{ color: '#0f172a' }}>{cycle}</strong>
            </span>
            <span style={{ fontSize: '0.75rem', color: '#64748b', fontFamily: 'DM Mono, monospace' }}>
              Ta: <strong style={{ color: '#1d4ed8' }}>{fmt(Ta)}</strong>
            </span>
          </div>
        </div>

        {/* ── Main layout: left sidebar + right content ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 12 }}>

          {/* ── LEFT COLUMN ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Parâmetros */}
            <div className="card">
              <div className="card-header">Parâmetros da Simulação</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Temperatura Inicial (Ta)
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="number"
                      value={inputTa}
                      onChange={e => setInputTa(Number(e.target.value))}
                      min={-10} max={50} step={0.5}
                    />
                    <span style={{ fontSize: '0.78rem', color: '#64748b' }}>°C</span>
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Temperatura Desejada (Td)
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="number"
                      value={inputTd}
                      onChange={e => setInputTd(Number(e.target.value))}
                      min={-10} max={45} step={0.5}
                    />
                    <span style={{ fontSize: '0.78rem', color: '#64748b' }}>°C</span>
                  </div>
                </div>
                <button className="btn btn-ghost" style={{ width: '100%', fontSize: '0.75rem' }} onClick={handleApplyParams}>
                  Aplicar e Reiniciar
                </button>
              </div>
            </div>

            {/* Controle */}
            <div className="card">
              <div className="card-header">Controle da Simulação</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <button
                  className="btn btn-primary"
                  style={{ gridColumn: '1 / -1' }}
                  onClick={() => setIsRunning(r => !r)}
                >
                  {isRunning ? '⏸ Pausar' : '▶ Iniciar Simulação'}
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={step}
                  disabled={isRunning}
                >
                  ⏭ Avançar Ciclo
                </button>
                <button
                  className="btn btn-danger"
                  onClick={handleReset}
                >
                  ↺ Resetar
                </button>
              </div>
            </div>

            {/* Estado do Agente */}
            <div className="card">
              <div className="card-header">Estado Atual do Agente</div>

              {/* Big temperature display */}
              <div style={{ textAlign: 'center', padding: '8px 0 12px' }}>
                <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
                  Temperatura Atual
                </div>
                <div className="temp-value" style={{ color: Ta > limit ? '#dc2626' : Ta <= Td ? '#16a34a' : '#1d4ed8' }}>
                  {fmt(Ta)}
                </div>
              </div>

              {/* Thermometer bar */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: '#94a3b8', fontFamily: 'DM Mono, monospace', marginBottom: 4 }}>
                  <span>{(Td - 4).toFixed(0)} °C</span>
                  <span>{(Td + 8).toFixed(0)} °C</span>
                </div>
                <div className="thermometer-bar">
                  <div
                    className="therm-fill"
                    style={{
                      width: `${Math.min(100, Math.max(0, (Ta - (Td - 4)) / 12 * 100))}%`,
                      background: Ta > limit ? '#ef4444' : Ta > Td ? '#f59e0b' : '#22c55e',
                    }}
                  />
                  {/* Td marker */}
                  <div className="therm-marker" style={{
                    left: `${Math.min(100, Math.max(0, (Td - (Td - 4)) / 12 * 100))}%`,
                    background: '#1d4ed8',
                  }} title={`Td = ${fmt(Td)}`} />
                  {/* Limit marker */}
                  <div className="therm-marker" style={{
                    left: `${Math.min(100, Math.max(0, (limit - (Td - 4)) / 12 * 100))}%`,
                    background: '#dc2626',
                  }} title={`Limite = ${fmt(limit)}`} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', fontFamily: 'DM Mono, monospace', marginTop: 4 }}>
                  <span style={{ color: '#1d4ed8' }}>◆ Td = {fmt(Td)}</span>
                  <span style={{ color: '#dc2626' }}>◆ L = {fmt(limit)}</span>
                </div>
              </div>

              <div className="stat-row">
                <span className="stat-label">Sistema</span>
                <span>{systemOn
                  ? <span className="badge-on">● LIGADO</span>
                  : <span className="badge-off">○ DESLIGADO</span>
                }</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Td (desejada)</span>
                <span className="stat-value">{fmt(Td)}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Limite L</span>
                <span className="stat-value" style={{ color: '#dc2626' }}>{fmt(limit)}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">σ (desvio)</span>
                <span className="stat-value">{sigma.toFixed(3)}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Tempo de Espera</span>
                <span>
                  {waitTime > 0
                    ? <span className="badge-warn">⏱ {waitTime} ciclo{waitTime !== 1 ? 's' : ''}</span>
                    : <span className="stat-value">0 (perceber agora)</span>
                  }
                </span>
              </div>
              {currentEpisode && (
                <div className="stat-row">
                  <span className="stat-label">Episódio ativo</span>
                  <span className="stat-value" style={{ color: currentEpisode.type === 'cooling' ? '#0891b2' : '#d97706', fontSize: '0.72rem' }}>
                    {currentEpisode.type === 'cooling' ? '↓ Resfriamento' : '↑ Aquecimento'}
                    {' '}(Ti={currentEpisode.Ti.toFixed(1)})
                  </span>
                </div>
              )}

              {/* Last decision */}
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                  Última Decisão
                </div>
                <div style={{ fontFamily: 'DM Mono, monospace', fontWeight: 500, fontSize: '0.82rem', color: '#0f172a', marginBottom: 6 }}>
                  {lastDecision || '—'}
                </div>
              </div>
            </div>

            {/* Aprendizado */}
            <div className="card">
              <div className="card-header">Aprendizado Térmico</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 6, padding: '8px 12px' }}>
                  <div style={{ fontSize: '0.68rem', color: '#0369a1', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                    ↓ Resfriamento
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#0c4a6e' }}>
                    Episódios: <strong>{coolingCount}</strong>
                  </div>
                  {avgCoolingRate !== null ? (
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.85rem', color: '#0369a1', fontWeight: 500, marginTop: 2 }}>
                      r↓ = {avgCoolingRate.toFixed(4)} °C/ciclo
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.72rem', color: '#64748b', fontStyle: 'italic', marginTop: 2 }}>
                      Sem experiências ainda.
                    </div>
                  )}
                </div>

                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '8px 12px' }}>
                  <div style={{ fontSize: '0.68rem', color: '#92400e', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                    ↑ Aquecimento Natural
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#78350f' }}>
                    Episódios: <strong>{heatingCount}</strong>
                  </div>
                  {avgHeatingRate !== null ? (
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: '0.85rem', color: '#92400e', fontWeight: 500, marginTop: 2 }}>
                      r↑ = {avgHeatingRate.toFixed(4)} °C/ciclo
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.72rem', color: '#64748b', fontStyle: 'italic', marginTop: 2 }}>
                      Sem experiências ainda.
                    </div>
                  )}
                </div>

                {episodes.length > 0 && (
                  <div style={{ fontSize: '0.7rem', color: '#475569', lineHeight: 1.5, marginTop: 2 }}>
                    {avgCoolingRate !== null && avgCoolingRate > 0 && (
                      <>A estimativa de tempo de espera agora usa a taxa aprendida de resfriamento ({avgCoolingRate.toFixed(3)} °C/ciclo).<br /></>
                    )}
                    {coolingCount === 0 && heatingCount === 0 && 'O agente ainda não completou nenhum episódio.'}
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* ── RIGHT COLUMN ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Explicação da Decisão */}
            <div className={decisionClass}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4, opacity: 0.7 }}>
                Explicação da Decisão Atual
              </div>
              <div style={{ fontWeight: 500 }}>{lastExplanation}</div>
            </div>

            {/* Gráfico */}
            <div className="card">
              <div className="card-header">Evolução da Temperatura (últimos 60 ciclos)</div>
              <div style={{ height: 200 }}>
                <TemperatureChart
                  data={recentChart}
                  min={tempMin}
                  max={tempMax}
                  desired={Td}
                  limit={limit}
                />
              </div>

              {/* Status bar below chart */}
              <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', color: '#475569' }}>
                  <span style={{ width: 20, height: 2, background: '#0891b2', display: 'inline-block' }} />
                  Temperatura Atual
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', color: '#475569' }}>
                  <span style={{ width: 20, height: 2, background: '#1d4ed8', display: 'inline-block', borderTop: '2px dashed #1d4ed8' }} />
                  Td = Temperatura Desejada
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', color: '#475569' }}>
                  <span style={{ width: 20, height: 2, background: '#dc2626', display: 'inline-block', borderTop: '2px dashed #dc2626' }} />
                  L = Limite (Td + 3σ)
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {systemOn
                    ? <span style={{ fontSize: '0.72rem', background: '#dbeafe', color: '#1e40af', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>❄ Resfriando</span>
                    : Ta < Td - 0.4
                    ? <span style={{ fontSize: '0.72rem', background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>🔆 Aquecendo</span>
                    : <span style={{ fontSize: '0.72rem', background: '#f0fdf4', color: '#15803d', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>✓ Estável</span>
                  }
                </div>
              </div>
            </div>

            {/* Bottom: Memory + History side by side */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

              {/* Memory / Episodes */}
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '12px 14px 0', borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ display: 'flex', gap: 0, marginBottom: 8 }}>
                    <button
                      onClick={() => setActiveTab('memory')}
                      style={{
                        fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                        padding: '4px 12px', borderRadius: '4px 4px 0 0', border: 'none', cursor: 'pointer',
                        background: activeTab === 'memory' ? '#1d4ed8' : 'transparent',
                        color: activeTab === 'memory' ? 'white' : '#94a3b8',
                      }}
                    >
                      Memória
                    </button>
                    <button
                      onClick={() => setActiveTab('episodes')}
                      style={{
                        fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                        padding: '4px 12px', borderRadius: '4px 4px 0 0', border: 'none', cursor: 'pointer',
                        background: activeTab === 'episodes' ? '#1d4ed8' : 'transparent',
                        color: activeTab === 'episodes' ? 'white' : '#94a3b8',
                      }}
                    >
                      Episódios ({episodes.length})
                    </button>
                  </div>
                </div>

                {activeTab === 'memory' ? (
                  <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 260 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead style={{ position: 'sticky', top: 0 }}>
                        <tr>
                          {['Ciclo', 'Ta', 'Td', 'Estado', 'Ação', 'Ti', 'ΔT'].map(h => (
                            <th key={h} className="table-header">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {memory.length === 0 ? (
                          <tr><td colSpan={7} className="table-cell" style={{ textAlign: 'center', color: '#94a3b8', fontStyle: 'italic' }}>Sem registros</td></tr>
                        ) : (
                          memory.map((m, i) => (
                            <tr key={i} style={{ background: i % 2 === 0 ? '#f8fafc' : 'white' }}>
                              <td className="table-cell" style={{ color: '#64748b' }}>{m.cycle}</td>
                              <td className="table-cell" style={{ color: '#0891b2' }}>{m.Ta.toFixed(1)}</td>
                              <td className="table-cell" style={{ color: '#1d4ed8' }}>{m.Td.toFixed(1)}</td>
                              <td className="table-cell">
                                {m.state === 'on'
                                  ? <span style={{ color: '#16a34a', fontWeight: 600 }}>Ligado</span>
                                  : <span style={{ color: '#64748b' }}>Desligado</span>
                                }
                              </td>
                              <td className="table-cell" style={{ color: '#0f172a', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.action}</td>
                              <td className="table-cell" style={{ color: '#7c3aed' }}>{m.Ti !== null ? m.Ti.toFixed(1) : '—'}</td>
                              <td className="table-cell" style={{ color: '#0369a1' }}>{m.deltaT !== null ? `${m.deltaT}` : '—'}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 260 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead style={{ position: 'sticky', top: 0 }}>
                        <tr>
                          {['Tipo', 'Ti', 'Td', 'ΔT', 'Taxa'].map(h => (
                            <th key={h} className="table-header">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {episodes.length === 0 ? (
                          <tr><td colSpan={5} className="table-cell" style={{ textAlign: 'center', color: '#94a3b8', fontStyle: 'italic' }}>Sem episódios completos</td></tr>
                        ) : (
                          episodes.map((ep, i) => (
                            <tr key={i} style={{ background: i % 2 === 0 ? '#f8fafc' : 'white' }}>
                              <td className="table-cell">
                                {ep.type === 'cooling'
                                  ? <span style={{ color: '#0891b2', fontWeight: 600 }}>↓ Resfr.</span>
                                  : <span style={{ color: '#d97706', fontWeight: 600 }}>↑ Aquec.</span>
                                }
                              </td>
                              <td className="table-cell">{ep.Ti.toFixed(1)} °C</td>
                              <td className="table-cell">{ep.Td.toFixed(1)} °C</td>
                              <td className="table-cell">{ep.deltaT} ciclos</td>
                              <td className="table-cell">{ep.rate.toFixed(3)} °C/c</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* History */}
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="card-header" style={{ padding: '12px 14px', margin: 0, borderRadius: 0 }}>
                  Histórico de Decisões
                </div>
                <div
                  ref={historyRef}
                  style={{ overflowY: 'auto', maxHeight: 290, padding: '8px 12px' }}
                >
                  {history.length === 0 ? (
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontStyle: 'italic' }}>Sem registros.</div>
                  ) : (
                    history.map((line, i) => {
                      const isDecision = line.includes('Decisão:')
                      const isEpisode = line.includes('Episódio') || line.includes('Percepção')
                      const isSeparator = line.includes('───')
                      return (
                        <div
                          key={i}
                          className="log-entry"
                          style={{
                            color: isDecision ? '#1d4ed8'
                              : isSeparator ? '#475569'
                              : isEpisode ? '#0369a1'
                              : '#334155',
                            fontWeight: isDecision ? 600 : isSeparator ? 600 : 400,
                          }}
                        >
                          {line}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ marginTop: 16, textAlign: 'center', fontSize: '0.68rem', color: '#94a3b8', fontFamily: 'DM Mono, monospace' }}>
          Rafael Araújo - Inteligência Artificial (CSI701)
        </div>
      </div>
    </div>
  )
}
