{{/*
Expand the name of the chart.
*/}}
{{- define "rudder.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this
(by the DNS naming spec). If release name contains chart name it will be used as
a full name.
*/}}
{{- define "rudder.fullname" -}}
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
{{- define "rudder.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels — applied to every resource the chart renders.
*/}}
{{- define "rudder.labels" -}}
helm.sh/chart: {{ include "rudder.chart" . }}
{{ include "rudder.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: rudder
{{- end }}

{{/*
Selector labels — release-scoped, stable across upgrades. These are added on
top of each component's own `app.kubernetes.io/name: <component>` label (which
is what the Services actually select on, preserving the source manifests).
*/}}
{{- define "rudder.selectorLabels" -}}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Resolve a component image reference.

Usage:
  {{ include "rudder.image" (dict "root" $ "component" .Values.controlPlane) }}

Resolution order:
  1. component.image.fullOverride  — explicit full ref wins (e.g. external pinned digests).
  2. {{ .Values.image.registry }}/{{ component.image.repository }}:{{ tag }}
     where tag defaults to .Chart.AppVersion when component.image.tag is empty.
*/}}
{{- define "rudder.image" -}}
{{- $root := .root -}}
{{- $img := .component.image -}}
{{- if $img.fullOverride -}}
{{- $img.fullOverride -}}
{{- else -}}
{{- $tag := $img.tag | default $root.Chart.AppVersion -}}
{{- printf "%s/%s:%s" $root.Values.image.registry $img.repository $tag -}}
{{- end -}}
{{- end }}
