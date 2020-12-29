const WebSocket = require(`ws`)
const EventEmitter = require(`events`)

module.exports = class GuiConnection extends EventEmitter {

  constructor() {

    super()

    this.wss = new WebSocket.Server({
      host: `localhost`,
      port: 80,
    })
    this.sockets = []

    this.wss.on(`listening`, () => {
      console.log(`Websocket server ready and listening`)
    })
    
    this.wss.on(`connection`, (socket, request) => {
    
      this.emit(`ready`)
      this.sockets.push(socket)
      
      socket.on(`message`, (data) => {
    
        console.log(`data:`, data)
        socket.send(`Received: ${data}`)
        this.emit(`message`, data)
    
      })
    
      socket.on(`error`, (err) => {
        console.error(`err:`, err)
      })
    
      socket.on(`close`, (code, reason) => {

        this.sockets.pop()
        console.log(`Socket closed with code ${code}, reason:`, reason)

      })
      
    })
    
    this.wss.on(`error`, (err) => {
    
      console.error(`err:`, err)
      
    })
    
  }

  get connected() {
    return this.sockets.length > 0 && this.sockets[0].readyState === 1
  }

  send(payload) {
    
    if (!this.connected) {
      throw new Error(`Can't send a message before a connection has been established!`)
    }
    
    this.sockets[0].send(JSON.stringify(payload))
    
  }
  
}
