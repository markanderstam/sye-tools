import { consoleLog, execSync } from './common'

export function installTillerRbac(kubeconfig: string) {
    const rbacSpec = `---
#
# Service account for Helm Tiller usage
#
apiVersion: v1
kind: ServiceAccount
metadata:
  name: tiller
  namespace: kube-system
---
#
# Helm needs to be cluster admin in order to work
#
apiVersion: rbac.authorization.k8s.io/v1beta1
kind: ClusterRoleBinding
metadata:
  name: tiller
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cluster-admin
subjects:
  - kind: ServiceAccount
    name: tiller
    namespace: kube-system`
    consoleLog(`Installing/updating Tiller service account and role binding:`)
    execSync(`kubectl --kubeconfig ${kubeconfig} apply -f -`, {
        input: rbacSpec,
    })
    consoleLog('  Done.')
}

export function installTiller(kubeconfig: string) {
    try {
        consoleLog('Installing Tiller (Helm):')
        execSync(`kubectl --kubeconfig ${kubeconfig} --namespace kube-system get deployment.apps/tiller-deploy 2>&1`)
        consoleLog('  Already installed - OK.')
    } catch (ex) {
        consoleLog('  Installing Tiller...')
        execSync(`helm init --kubeconfig ${kubeconfig} --service-account tiller`)
        consoleLog('  Done.')
    }
}

export function waitForTillerStarted(kubeconfig: string) {
    consoleLog('Wait for Tiller to be ready...')
    execSync(
        `kubectl --kubeconfig ${kubeconfig} --namespace kube-system wait pods --for condition=ready -l app=helm,name=tiller --timeout=300s`
    )
    consoleLog('  Tiller is ready.')
}

export function installNginxIngress(kubeconfig: string) {
    consoleLog('Installing/updating NGINX Ingress:')
    execSync(
        `helm upgrade --kubeconfig ${kubeconfig} --install --namespace kube-system --set replicaCount=2 nginx-ingress stable/nginx-ingress`
    )
    consoleLog('  Done.')
}

export function installMetricsServer(kubeconfig: string) {
    consoleLog('Installing/updating Metrics Server:')
    execSync(
        `helm upgrade --kubeconfig ${kubeconfig} --install --namespace kube-system metrics-server stable/metrics-server`
    )
    consoleLog('  Done.')
}

export function installPrometheusOperator(kubeconfig: string) {
    consoleLog('Installing/updating Prometheus Operator:')
    execSync(`helm upgrade --kubeconfig ${kubeconfig} --install --namespace prometheus --wait \
--set prometheus.enabled=false \
--set alertmanager.enabled=false \
--set grafana.enabled=false \
--set kubeApiServer.enabled=false \
--set kubelet.enabled=false \
--set kubeControllerManager.enabled=false \
--set coreDns.enabled=false \
--set kubeDns.enabled=false \
--set kubeEtcd.enabled=false \
--set kubeStateMetrics.enabled=false \
--set nodeExporter.enabled=false \
prometheus-operator stable/prometheus-operator`)
    consoleLog('  Done.')
}

export function installPrometheus(kubeconfig: string) {
    consoleLog('Installing/updating Prometheus:')
    execSync(`kubectl apply --kubeconfig ${kubeconfig} --namespace prometheus -f lib/prometheus`)
    consoleLog('  Done.')
}

export function installPrometheusAdapter(kubeconfig: string) {
    consoleLog('Installing/updating Prometheus Adapter:')
    execSync(`helm upgrade --kubeconfig ${kubeconfig} --install --namespace prometheus \
    --set prometheus.url=http://metrics.prometheus.svc \
    --set prometheus.port=9090 \
    --set image.repository=bhavin192/k8s-prometheus-adapter-amd64 --set image.tag=pr110 \
    prometheus-adapter stable/prometheus-adapter`)
    consoleLog('  Done.')
}

export function installClusterAutoscaler(
    kubeconfig: string,
    clusterName: string,
    region: string,
    cloudProvider: string
) {
    consoleLog('Installing/updating Cluster Autoscaler:')
    execSync(`helm upgrade --kubeconfig ${kubeconfig} --install --namespace kube-system \
--set autoDiscovery.clusterName=${clusterName} \
--set awsRegion=${region} \
--set cloudProvider=${cloudProvider} \
--set image.tag=v1.2.2 \
--set-string extraArgs.skip-nodes-with-local-storage=false \
--set-string extraArgs.skip-nodes-with-system-pods=false \
--set extraArgs.scale-down-delay-after-add=2m \
--set extraArgs.scale-down-unneeded-time=2m \
--set rbac.create=true \
--set sslCertPath=/etc/kubernetes/pki/ca.crt \
autoscaler stable/cluster-autoscaler`)
    consoleLog('  Done.')
}
