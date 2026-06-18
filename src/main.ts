import './styles.css'
import { Lab04App } from './app/Lab04App'

const root = document.querySelector<HTMLDivElement>('#app')

if (!root) {
  throw new Error('缺少 #app 根节点')
}

const app = new Lab04App(root)
app.start()

