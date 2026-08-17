import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { uz } from '../../lib/uz'
import { useApi } from '../../lib/hooks'
import { Badge, Button, Card, Empty, Input, Loading, Notice, StatusBadge } from '../../components/ui'
import type { PatientStatus } from '../../lib/types'
import { formatDate, initials } from '../../lib/format'

interface PlanRow {
  id: number
  version: number
  status: 'draft' | 'active' | 'archived'
  approved_at: string | null
  start_date: string | null
  patient_id: number
  first_name: string
  last_name: string
  patient_status: PatientStatus
  diabetes_type: 'type1' | 'type2' | 'other' | null
  approver_name: string | null
  medication_count: number
  monitoring_count: number
}

const FILTERS = [
  { key: 'active', label: uz.carePlan.active },
  { key: 'draft', label: uz.carePlan.draft },
  { key: 'archived', label: uz.carePlan.archived },
  { key: 'all', label: uz.app.all },
]

export function CarePlansPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('active')
  const [query, setQuery] = useState('')
  const { data, loading } = useApi<{ plans: PlanRow[] }>(
    `/care-plans?status=${status}&query=${encodeURIComponent(query)}`,
    [status, query],
  )

  return (
    <div className="stack">
      <Notice tone="info">{uz.carePlan.versionNote}</Notice>

      <div className="row--between">
        <Input
          placeholder={uz.patients.searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 380 }}
        />
        <div className="chip-group">
          {FILTERS.map((filter) => (
            <button
              key={filter.key}
              className={`chip ${status === filter.key ? 'chip--on' : ''}`}
              onClick={() => setStatus(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      <Card
        title={uz.carePlan.listTitle}
        subtitle={data ? `${data.plans.length} ta reja` : undefined}
        flush
      >
        {loading ? (
          <Loading />
        ) : !data || data.plans.length === 0 ? (
          <Empty icon="📋" title={uz.carePlan.noPlan} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{uz.patients.columns.patient}</th>
                  <th>{uz.patients.columns.diabetesType}</th>
                  <th>{uz.carePlan.version}</th>
                  <th>{uz.carePlan.medications}</th>
                  <th>{uz.carePlan.monitoring}</th>
                  <th>{uz.carePlan.approvedBy}</th>
                  <th>{uz.patients.columns.status}</th>
                </tr>
              </thead>
              <tbody>
                {data.plans.map((plan) => (
                  <tr key={plan.id} onClick={() => navigate(`/shifoxona/bemorlar/${plan.patient_id}`)}>
                    <td>
                      <div className="person">
                        <span className="avatar" aria-hidden>{initials(plan.first_name, plan.last_name)}</span>
                        <span>
                          <span className="person__name" style={{ display: 'block' }}>
                            {plan.last_name} {plan.first_name}
                          </span>
                          <span className="person__meta">
                            {uz.carePlan.startDate}: {formatDate(plan.start_date)}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td>{plan.diabetes_type ? uz.diabetesType[plan.diabetes_type] : uz.app.notSpecified}</td>
                    <td>
                      <Badge tone={plan.status === 'active' ? 'stable' : 'neutral'}>
                        v{plan.version} · {uz.carePlan[plan.status]}
                      </Badge>
                    </td>
                    <td>{plan.medication_count} ta</td>
                    <td>{plan.monitoring_count} ta</td>
                    <td className="small">{plan.approver_name ?? uz.carePlan.notApproved}</td>
                    <td><StatusBadge status={plan.patient_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div>
        <Button variant="primary" onClick={() => navigate('/shifoxona/royxat')}>
          ➕ {uz.nav.hospital.register}
        </Button>
      </div>
    </div>
  )
}
