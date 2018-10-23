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
        `kubectl --kubeconfig ${kubeconfig} --namespace kube-system wait pods --for condition=ready -l app=helm,name=tiller`
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
