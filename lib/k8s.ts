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
        env: {
            KUBECONFIG: kubeconfig,
        },
    })
    consoleLog('  Done.')
}

export function installTiller(kubeconfig: string) {
    try {
        consoleLog('Installing Tiller (Helm):')
        execSync(`kubectl --namespace kube-system get deployment.apps/tiller-deploy`, {
            env: {
                KUBECONFIG: kubeconfig,
            },
        })
        consoleLog('  Already installed - OK.')
    } catch (ex) {
        consoleLog('  Installing Tiller...')
        execSync(`helm init --service-account tiller`, {
            env: {
                KUBECONFIG: kubeconfig,
            },
        })
        consoleLog('  Done.')
    }
}

export function waitForTillerStarted(kubeconfig: string) {
    consoleLog('Wait for Tiller to be ready...')
    execSync(`kubectl --namespace kube-system wait pods --for condition=ready -l app=helm,name=tiller`, {
        env: {
            KUBECONFIG: kubeconfig,
        },
    })
    consoleLog('  Tiller is ready.')
}

export function installNginxIngress(kubeconfig: string) {
    consoleLog('Installing/updating NGINX Ingress:')
    execSync(`helm upgrade --install --namespace kube-system --set replicaCount=2 nginx-ingress stable/nginx-ingress`, {
        env: {
            KUBECONFIG: kubeconfig,
        },
    })
    consoleLog('  Done.')
}
