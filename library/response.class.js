/* Common AMk2 Class */

class AssistantResponseClass {
  constructor (responseConfig, callbacks) {
    this.config = responseConfig
    this.callbacks = callbacks
    this.showing = false
    this.response = null
    this.aliveTimer = null
    this.displayTimer = null
    this.allStatus = [ "hook", "standby", "reply", "error", "think", "continue", "listen", "confirmation" ]
    this.secretMode = false
    this.hookChimed = false
    this.myStatus = { "actual" : "standby" , "old" : "standby" }
    this.sayMode = false

    if (this.config.useHTML5) {
      this.audioResponse = new Audio()
      this.audioResponse.autoplay = true
      this.audioResponse.addEventListener("ended", ()=>{
        this.callbacks.doPlugin("onAfterAudioResponse")
        log("audio end")
        this.end()
      })

      this.audioChime = new Audio()
      this.audioChime.autoplay = true
    }
  }

  tunnel (payload) {
    if (payload.type == "TRANSCRIPTION") {
      if (this.secretMode || this.sayMode) return
      var startTranscription = false
      if (payload.payload.done) this.status("confirmation")
      if (payload.payload.transcription && !startTranscription) {
        this.showTranscription(payload.payload.transcription)
        startTranscription = true
      }
    }
  }

  doCommand (commandName, param, from) {
    // do nothing currently.
  }

  setSecret (secretMode) {
    this.secretMode = secretMode
  }

  setSayMode (sayMode) {
    this.sayMode = sayMode
  }

  playChime (sound) {
    if (this.config.useChime && !(this.secretMode || this.sayMode)) {
      if (this.config.useHTML5) {
        this.audioChime.src = "modules/MMM-AssistantMk2/resources/" + this.config.chime[sound]
      } else {
        this.callbacks.playSound("resources/" + this.config.chime[sound])
      }
    }
  }

  status (status, beep) {
    var Status = document.getElementById("AMK2_STATUS")
    for (let [item,value] of Object.entries(this.allStatus)) {
      if(Status.classList.contains(value)) this.myStatus.old = value
    } // check old status and store it
    this.myStatus.actual = status

    if (beep && this.myStatus.old != "continue") this.playChime("beep")
    if (status == "error" || status == "continue" ) this.playChime(status)
    if (status == "WAVEFILE" || status == "TEXT") this.myStatus.actual = "think"
    if (status == "MIC") this.myStatus.actual = (this.myStatus.old == "continue") ? "continue" : "listen"
    log("Status from " + this.myStatus.old + " to " + this.myStatus.actual)
    if (!(this.secretMode || this.sayMode)) {
      Status.classList.remove(this.myStatus.old)
      Status.classList.add(this.myStatus.actual)
    }
    this.callbacks.myStatus(this.myStatus) // send status external
    this.callbacks.sendNotification("ASSISTANT_" + this.myStatus.actual.toUpperCase())
    this.myStatus.old = this.myStatus.actual
  }

  prepare () {
    // needed class plugin
  }

  getDom () {
    var dom = document.createElement("div")
    dom.id = "AMK2"
    if (this.config.useStaticIcons) {
      dom.classList.add(this.config.useStaticIcons === "standby" ? "static-standby" : "static")
    }
    console.warn(this.config.useStaticIcons)
    return dom
  }

  showError (text) {
    this.status("error")
    this.showTranscription(text, "error")
    this.callbacks.doPlugin("onError", text)
  }

  showTranscription (text, className = "transcription") {
    if (this.secretMode || this.sayMode) return
    var tr = document.getElementById("AMK2_TRANSCRIPTION")
    tr.innerHTML = ""
    var t = document.createElement("p")
    t.className = className
    t.innerHTML = text
    tr.appendChild(t)
  }

  end () {
    this.showing = false
    if (this.response) {
      var response = this.response
      this.response = null
      if (response && response.continue) {
        this.status("continue")
        log("Continuous Conversation")
        this.callbacks.assistantActivate({
          type: "MIC",
          profile: response.lastQuery.profile,
          key: null,
          lang: response.lastQuery.lang,
          useScreenOutput: response.lastQuery.useScreenOutput,
        }, Date.now())

      } else {
        this.callbacks.doPlugin("onBeforeInactivated")
        log("Conversation ends.")
        this.callbacks.endResponse()
        this.status("standby")
        clearTimeout(this.aliveTimer)
        this.aliveTimer = null
        this.aliveTimer = setTimeout(()=>{
          this.stopResponse(()=>{
            this.fullscreen(false, this.myStatus)
          })
        }, this.config.timer)
      }
    } else {
      this.callbacks.doPlugin("onBeforeInactivated")
      this.status("standby")
      this.callbacks.endResponse()
    }
  }

  start (response) {
    this.hookChimed = false
    this.response = response
    if (this.showing) {
      this.end()
    }

    if (response.error) {
      if (response.error == "TRANSCRIPTION_FAILS") {
        log("Transcription Failed. Re-try with text")
        this.callbacks.assistantActivate({
          type: "TEXT",
          profile: response.lastQuery.profile,
          key: response.transcription.transcription,
          lang: response.lastQuery.lang,
          useScreenOutput: response.lastQuery.useScreenOutput,
          session: response.lastQuery.session
        }, null)
        return
      }
      if (response.error == "NO_RESPONSE" && response.lastQuery.status == "continue") {
        this.status("continue")
        this.callbacks.assistantActivate({
          type: "MIC",
          profile: response.lastQuery.profile,
          key: null,
          lang: response.lastQuery.lang,
          useScreenOutput: response.lastQuery.useScreenOutput,
        }, Date.now())
        return
      }
      this.showError(this.callbacks.translate(response.error))
      this.end()
      return
    }

    var normalResponse = (response) => {
      this.showing = true
      var so = this.showScreenOutput(response)
      if (this.config.useHTML5) {
        var ao = this.playAudioOutput(response)
        if (ao) {
          this.status("reply")
          log("Wait audio to finish")
        } else {
          log("No response")
          this.end()
        }
      } else {
        this.callbacks.doPlugin("onBeforeAudioResponse")
        this.showing = true
      }
    }
    this.postProcess(
      response,
      ()=>{
        response.continue = false // Issue: force to be false
        this.end()
      }, // postProcess done
      ()=>{ normalResponse(response) } // postProcess none
    )
  }

  stopResponse (callback = ()=>{}) {
    this.showing = false
    var winh = document.getElementById("AMK2_HELPER")
    winh.classList.add("hidden")
    var iframe = document.getElementById("AMK2_SCREENOUTPUT")
    iframe.src = "about:blank"
    if (this.config.useHTML5) {
      this.audioResponse.src = ""
    }
    var tr = document.getElementById("AMK2_TRANSCRIPTION")
    tr.innerHTML = ""
    var ts = document.getElementById("AMK2_TRYSAY")
    if (ts) {
      ts.innerHTML = ""
      var word = document.getElementById("AMK2_WORDBOX")
      word.innerHTML = ""
    }
    callback()
  }

  postProcess (response, callback_done=()=>{}, callback_none=()=>{}) {
    this.callbacks.postProcess(response, callback_done, callback_none)
  }

  playAudioOutput (response) {
    if (this.secretMode) return false
    if (response.audio && this.config.useAudioOutput) {
      this.callbacks.doPlugin("onBeforeAudioResponse")
      this.showing = true
      if (this.config.useHTML5) {
        this.audioResponse.src = this.makeUrl(response.audio.uri)
      }
      return true
    }
    return false
  }

  showScreenOutput (response) {
    if (this.secretMode || this.sayMode) return false
    if (response.screen && this.config.useScreenOutput) {
      this.callbacks.doPlugin("onBeforeScreenResponse")
      if (!response.audio) {
        this.showTranscription(this.callbacks.translate("NO_AUDIO_RESPONSE"))
      }
      this.showing = true
      var iframe = document.getElementById("AMK2_SCREENOUTPUT")
      iframe.src = this.makeUrl(response.screen.uri)
      var winh = document.getElementById("AMK2_HELPER")
      winh.classList.remove("hidden")

      /* --- HelpWord Box ---*/
      var wordbox = document.getElementById("AMK2_WORDBOX")
      var trysay = document.getElementById("AMK2_TRYSAY")
      if (trysay) { // only if AMK2_TRYSAY is used
        trysay.textContent = ""
        wordbox.innerHTML = ""
        if(response.screen.trysay) {
          trysay.textContent = response.screen.trysay
          var word = []
          for (let [item, value] of Object.entries(response.screen.help)) {
            word[item] = document.createElement("div")
            word[item].id = "AMK2_WORD"
            word[item].textContent = value
            wordbox.appendChild(word[item])
          }
        }
      }
      /* --- HelpWord Box --- */
      this.callbacks.doPlugin("onAfterScreenResponse")
      return true
    }
    return false
  }

  makeUrl (uri) {
    return "/modules/MMM-AssistantMk2/" + uri + "?seed=" + Date.now()
  }

  fullscreen (active, status) {
    // need class plugin
  }
}
