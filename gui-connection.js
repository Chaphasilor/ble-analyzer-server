const WebSocket = require(`ws`)
const EventEmitter = require(`events`)
const uuid = require(`uuid`).v4

module.exports = class GuiConnection extends EventEmitter {

  constructor(server) {

    super()

    this.wss = new WebSocket.Server({
      server,
    })
    this.sockets = new Map()
    this.subscriptions = {}

    this.wss.on(`listening`, () => {
      console.log(`Websocket server ready and listening`)
      this.emit(`ready`)
    })
    
    this.wss.on(`connection`, (socket, request) => {

      let socketId = uuid()
      socket.send(JSON.stringify(socketId))
    
      this.emit(`new-client`, socketId)
      this.sockets.set(socketId, socket)
      
      socket.on(`message`, (data) => {
    
        let parsed
        try {
          parsed = JSON.parse(data)
        } catch (err) {
          console.error(`err:`, err);
        }
        
        console.log(`data:`, data)
        
        switch (parsed.type) {
          case `command`:
            this.emit(`command`, socketId, parsed.value)
            break;
        
          default:
            console.error(`Unrecognized message type:`, parsed.type)
            break;
        }
        
        // this.emit(`message`, data)
    
      })
    
      socket.on(`error`, (err) => {
        console.error(`err:`, err)
      })
    
      socket.on(`close`, (code, reason) => {

        this.unsubscribe(socketId)
        this.sockets.delete(socketId)
        console.log(`this.sockets:`, this.sockets)
        console.log(`Socket closed with code ${code}, reason:`, reason)
        this.emit(`close`)

      })
      
    })
    
    this.wss.on(`error`, (err) => {
    
      console.error(`err:`, err)
      
    })
    
  }

  send(socketId, payload) {
    
    if (payload === undefined) {
      throw new Error(`Missing socket ID or payload!`)
    }

    const stringifiedPayload = JSON.stringify(payload)

    let socket = this.sockets.get(socketId)
    if (!socket) {
      throw new Error(`Socket with id '${socketId} not found!'`)
    }
    if (socket.readyState !== 1) {
      throw new Error(`Socket '${socketId}' isn't ready yet!`)
    }
    
    this.sockets.get(socketId).send(stringifiedPayload)
    
  }

  broadcast(command, payload) {

    if (command === undefined || payload === undefined) {
      throw new Error(`Missing command name or payload!`)
    }

    // console.info(`Broadcasting`)

    const stringifiedPayload = JSON.stringify(payload)
      
    if (this.subscriptions[command]) {

      this.subscriptions[command].forEach(socketId => {

        let socket = this.sockets.get(socketId)
        if (!socket) {
          throw new Error(`Socket with id '${socketId} not found!'`)
        }
        if (socket.readyState !== 1) {
          throw new Error(`Socket '${socketId}' isn't ready yet!`)
        }
        
        this.sockets.get(socketId).send(stringifiedPayload)
        
      })

    }
    
  }

  subscribe(socketId, command) {

    if (this.subscriptions[command]) {
      this.subscriptions[command].push(socketId)
    } else {
      this.subscriptions[command] = [socketId]
    }
    
  }

  unsubscribe(socketId, command) {

    // unsubscribe from all commands
    if (!command) {
      
      Object.keys(this.subscriptions).forEach(command => {
        console.log(`command:`, command)
        console.log(`this.subscriptions:`, this.subscriptions)
        this.subscriptions[command] = this.subscriptions[command].filter(x => x !== socketId)
      })
      
    } else {

      if (this.subscriptions[command]) {
        this.subscriptions[command] = this.subscriptions[command].filter(x => x !== socketId)
      }

    }
    
  }
  
}
