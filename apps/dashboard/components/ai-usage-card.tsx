import type { AiUsage } from "@skiffr/common/schemas"
import { Card, CardContent, CardHeader, CardTitle } from "@skiffr/ui/components/card"
import { usageLine } from "@/lib/ai-usage-copy"

export function AiUsageCard({ usage }: { usage: AiUsage }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI use</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{usageLine(usage)}</p>
      </CardContent>
    </Card>
  )
}
