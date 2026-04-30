{{/*
Expand the name of the chart.
*/}}
{{- define "yoizenclaw-runtime.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "yoizenclaw-runtime.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "yoizenclaw-runtime.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "yoizenclaw-runtime.labels" -}}
helm.sh/chart: {{ include "yoizenclaw-runtime.chart" . }}
{{ include "yoizenclaw-runtime.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: yoizen-arch
yoizen.io/managed-by: helm
yoizen.io/environment: {{ .Values.environment | default "dev" }}
{{- with .Values.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "yoizenclaw-runtime.selectorLabels" -}}
app.kubernetes.io/name: {{ include "yoizenclaw-runtime.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
yoizen.io/tenant: {{ required "tenantId is required" .Values.tenantId }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "yoizenclaw-runtime.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "yoizenclaw-runtime.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Compute PostgreSQL host
*/}}
{{- define "yoizenclaw-runtime.postgresHost" -}}
{{- if .Values.postgres.host }}
{{- .Values.postgres.host }}
{{- else }}
{{- printf "postgres.%s-%s-ns.svc.cluster.local" .Values.tenantId .Values.environment }}
{{- end }}
{{- end }}
