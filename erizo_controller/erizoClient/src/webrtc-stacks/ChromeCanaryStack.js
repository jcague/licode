/*global window, console, RTCSessionDescription, RoapConnection, webkitRTCPeerConnection*/

var Erizo = Erizo || {};

Erizo.ChromeCanaryStack = function (spec) {
    "use strict";

    var that = {},
        WebkitRTCPeerConnection = webkitRTCPeerConnection;

    that.pc_config = {
        "iceServers": []
    };
    that.maxVideoBW = spec.maxVideoBW;
    that.maxAudioBW = spec.maxAudioBW;
    that.audioCodec = spec.audioCodec;
    that.opusHz = spec.opusHz;
    that.opusBitrate = spec.opusBitrate;

    that.con = {'optional': [{'DtlsSrtpKeyAgreement': true}]};

    if (spec.stunServerUrl !== undefined) {
        that.pc_config.iceServers.push({"url": spec.stunServerUrl});
    }

    if ((spec.turnServer || {}).url) {
        that.pc_config.iceServers.push({"username": spec.turnServer.username, "credential": spec.turnServer.password, "url": spec.turnServer.url});
    }

    if (spec.audio === undefined || spec.nop2p) {
        spec.audio = true;
    }

    if (spec.video === undefined || spec.nop2p) {
        spec.video = true;
    }

    that.mediaConstraints = {
        'mandatory': {
            'OfferToReceiveVideo': spec.video,
            'OfferToReceiveAudio': spec.audio
        }
    };

    that.roapSessionId = 103;

    that.peerConnection = new WebkitRTCPeerConnection(that.pc_config, that.con);

    that.peerConnection.onicecandidate = function (event) {
        L.Logger.debug("Have ice candidate for session: ", spec.session_id);
        // HACK (bf) If no new ice candidates for 0.5s, stop waiting
        clearTimeout(that.moreIceTimeout);
        that.moreIceTimeout = setTimeout(function() {
            if (that.moreIceComing) {
                that.moreIceComing = false;
                that.markActionNeeded();
            }
        }, 500);

        if (!event.candidate) {
            // At the moment, we do not renegotiate when new candidates
            // show up after the more flag has been false once.
            L.Logger.debug("State: " + that.peerConnection.iceGatheringState);

            if (that.ices === undefined) {
                that.ices = 0;
            }
            that.ices = that.ices + 1;
            if (that.ices >= 1 && that.moreIceComing) {
                that.moreIceComing = false;
                that.markActionNeeded();
                clearTimeout(that.moreIceTimeout);
            }
        } else {
            var type = event.candidate.candidate.split(" ")[7];
            that.iceCandidateCount += 1;
        }
    };

    var setMaxBW = function (sdp) {
        if (that.maxVideoBW) {
            var a = sdp.match(/m=video.*\r\n/);
            var r = a[0] + "b=AS:" + that.maxVideoBW + "\r\n";
            sdp = sdp.replace(a[0], r);
        }

        if (that.maxAudioBW) {
            var a = sdp.match(/m=audio.*\r\n/);
            var r = a[0] + "b=AS:" + that.maxAudioBW + "\r\n";
            sdp = sdp.replace(a[0], r);
        }

        return sdp;
    };

    var setMaxBW = function (sdp) {
        if (that.maxVideoBW) {
            var a = sdp.match(/m=video.*\r\n/);
            var r = a[0] + "b=AS:" + that.maxVideoBW + "\r\n";
            sdp = sdp.replace(a[0], r);
        }

        if (that.maxAudioBW) {
            var a = sdp.match(/m=audio.*\r\n/);
            var r = a[0] + "b=AS:" + that.maxAudioBW + "\r\n";
            sdp = sdp.replace(a[0], r);
        }
        return sdp;
    };


    var setAudioCodec = function(sdp) {
        var temp;
        if (that.audioCodec) {
            if (that.audioCodec !== "opus") {
                temp = sdp.match(".*opus.*\r\na=fmtp.*\r\n");
                sdp = sdp.replace(temp, "");
            } else {
                if (that.opusHz) {
                    temp = sdp.match(".*opus.*\r\na=fmtp.*");
                    sdp = sdp.replace(temp, temp + 
                        "; maxplaybackrate=" + that.opusHz + 
                        "; sprop-maxcapturerate=" + that.opusHz);
                }
                if (that.opusBitrate) {
                    temp = sdp.match(".*opus.*\r\na=fmtp.*");
                    sdp = sdp.replace(temp, temp + 
                        "; maxaveragebitrate=" + that.opusBitrate);                    
                }
            }
            if (that.audioCodec !== "ISAC/32000") {
                temp = sdp.match(".*ISAC/32000\r\n");
                sdp = sdp.replace(temp, "");
            }
            if (that.audioCodec !== "ISAC/16000") {
                temp = sdp.match(".*ISAC/16000\r\n");
                sdp = sdp.replace(temp, "");
            }
        }
        return sdp;
    };

    var pruneIceCandidates = function(sdp) {

        /* Remove all TCP candidates.  Who needs em?! */
        var regExp = new RegExp(/a=candidate:\d+\s\d\stcp.+/g);
        sdp = sdp.replace(regExp,"");

        return sdp;
    };

    /**
     * This function processes signalling messages from the other side.
     * @param {string} msgstring JSON-formatted string containing a ROAP message.
     */
    that.processSignalingMessage = function (msgstring) {
        // Offer: Check for glare and resolve.
        // Answer/OK: Remove retransmit for the msg this is an answer to.
        // Send back "OK" if this was an Answer.
        L.Logger.debug('Activity on conn ' + that.sessionId);
        var msg = JSON.parse(msgstring), sd, regExp, exp;
        that.incomingMessage = msg;

        if (that.state === 'new') {
            if (msg.messageType === 'OFFER') {
                // Initial offer.
                sd = {
                    sdp: msg.sdp,
                    type: 'offer'
                };
                that.peerConnection.setRemoteDescription(new RTCSessionDescription(sd));

                that.state = 'offer-received';
                // Allow other stuff to happen, then reply.
                that.markActionNeeded();
            } else {
                that.error('Illegal message for this state: ' + msg.messageType + ' in state ' + that.state);
            }

        } else if (that.state === 'offer-sent') {
            if (msg.messageType === 'ANSWER') {

                //regExp = new RegExp(/m=video[\w\W]*\r\n/g);

                //exp = msg.sdp.match(regExp);
                //L.Logger.debug(exp);

                //msg.sdp = msg.sdp.replace(regExp, exp + "b=AS:100\r\n");

                sd = {
                    sdp: msg.sdp,
                    type: 'answer'
                };
                L.Logger.debug("Received ANSWER: ", sd.sdp);

                sd.sdp = setMaxBW(sd.sdp);
                sd.sdp = setAudioCodec(sd.sdp);

                that.peerConnection.setRemoteDescription(new RTCSessionDescription(sd));
                that.sendOK();
                that.state = 'established';

            } else if (msg.messageType === 'pr-answer') {
                sd = {
                    sdp: msg.sdp,
                    type: 'pr-answer'
                };
                that.peerConnection.setRemoteDescription(new RTCSessionDescription(sd));

                // No change to state, and no response.
            } else if (msg.messageType === 'offer') {
                // Glare processing.
                that.error('Not written yet');
            } else {
                that.error('Illegal message for this state: ' + msg.messageType + ' in state ' + that.state);
            }

        } else if (that.state === 'established') {
            if (msg.messageType === 'OFFER') {
                // Subsequent offer.
                sd = {
                    sdp: msg.sdp,
                    type: 'offer'
                };
                that.peerConnection.setRemoteDescription(new RTCSessionDescription(sd));

                that.state = 'offer-received';
                // Allow other stuff to happen, then reply.
                that.markActionNeeded();
            } else {
                that.error('Illegal message for this state: ' + msg.messageType + ' in state ' + that.state);
            }
        }
    };

    /**
     * Adds a stream - this causes signalling to happen, if needed.
     * @param {MediaStream} stream The outgoing MediaStream to add.
     */
    that.addStream = function (stream) {
        that.peerConnection.addStream(stream);
        that.markActionNeeded();
    };

    /**
     * Removes a stream.
     * @param {MediaStream} stream The MediaStream to remove.
     */
    that.removeStream = function (stream) {
//        var i;
//        for (i = 0; i < that.peerConnection.localStreams.length; ++i) {
//            if (that.localStreams[i] === stream) {
//                that.localStreams[i] = null;
//            }
//        }
        that.markActionNeeded();
    };

    /**
     * Closes the connection.
     */
    that.close = function () {
        that.state = 'closed';
        that.peerConnection.close();
    };

    /**
     * Internal function: Mark that something happened.
     */
    that.markActionNeeded = function () {
        that.actionNeeded = true;
        that.doLater(function () {
            that.onstablestate();
        });
    };

    /**
     * Internal function: Do something later (not on this stack).
     * @param {function} what Callback to be executed later.
     */
    that.doLater = function (what) {
        // Post an event to myself so that I get called a while later.
        // (needs more JS/DOM info. Just call the processing function on a delay
        // for now.)
        window.setTimeout(what, 1);
    };

    /**
     * Internal function called when a stable state
     * is entered by the browser (to allow for multiple AddStream calls or
     * other interesting actions).
     * This function will generate an offer or answer, as needed, and send
     * to the remote party using our onsignalingmessage function.
     */
    that.onstablestate = function () {
        var mySDP, roapMessage = {};
        if (that.actionNeeded) {
            if (that.state === 'new' || that.state === 'established') {
                // See if the current offer is the same as what we already sent.
                // If not, no change is needed.
                // Don't do anything until we have the ICE candidates.

                that.peerConnection.createOffer(function (sessionDescription) {

                    //sessionDescription.sdp = newOffer.replace(/a=ice-options:google-ice\r\n/g, "");
                    //sessionDescription.sdp = newOffer.replace(/a=crypto:0 AES_CM_128_HMAC_SHA1_80 inline:.*\r\n/g, "a=crypto:0 AES_CM_128_HMAC_SHA1_80 inline:eUMxlV2Ib6U8qeZot/wEKHw9iMzfKUYpOPJrNnu3\r\n");
                    //sessionDescription.sdp = newOffer.replace(/a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:.*\r\n/g, "a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:eUMxlV2Ib6U8qeZot/wEKHw9iMzfKUYpOPJrNnu3\r\n");

                    sessionDescription.sdp = setMaxBW(sessionDescription.sdp);
                    sessionDescription.sdp = setAudioCodec(sessionDescription.sdp);

                    var newOffer = sessionDescription.sdp;

                    if (newOffer !== that.prevOffer) {
                        L.Logger.debug("Have new SDP on createOffer");
                        that.peerConnection.setLocalDescription(sessionDescription);
                        that.prevOffer = that.peerConnection.localDescription.sdp;

                        if (that.moreIceComing) {
                            that.state = 'preparing-offer';
                        } else {
                            that.state = 'ice-gathering-finished'
                        }
                        that.markActionNeeded();
                        return;          
                    }

                }, null, that.mediaConstraints);

            } else if (that.state === 'preparing-offer') {
                if (that.moreIceComing) {
                    return;
                } else {
                    L.Logger.debug("ice-gathering-finished");

                    that.peerConnection.createOffer(function (sessionDescription) {

                        //sessionDescription.sdp = newOffer.replace(/a=ice-options:google-ice\r\n/g, "");
                        //sessionDescription.sdp = newOffer.replace(/a=crypto:0 AES_CM_128_HMAC_SHA1_80 inline:.*\r\n/g, "a=crypto:0 AES_CM_128_HMAC_SHA1_80 inline:eUMxlV2Ib6U8qeZot/wEKHw9iMzfKUYpOPJrNnu3\r\n");
                        //sessionDescription.sdp = newOffer.replace(/a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:.*\r\n/g, "a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:eUMxlV2Ib6U8qeZot/wEKHw9iMzfKUYpOPJrNnu3\r\n");

                        sessionDescription.sdp = setMaxBW(sessionDescription.sdp);
                        sessionDescription.sdp = setAudioCodec(sessionDescription.sdp);

                        sessionDescription.sdp = pruneIceCandidates(sessionDescription.sdp);

                        that.peerConnection.setLocalDescription(sessionDescription);
                        that.prevOffer = sessionDescription.sdp;

                        L.Logger.debug("setting state to ice-gathering-finished");
                        that.state = 'ice-gathering-finished'
                        that.markActionNeeded();
                        return;          

                    }, null, that.mediaConstraints);

                }

            } else if (that.state === 'ice-gathering-finished') {

                L.Logger.debug("Sending OFFER: " + that.prevOffer);
                //L.Logger.debug('Sent SDP is ' + that.prevOffer);
                that.sendMessage('OFFER', that.prevOffer);
                // Not done: Retransmission on non-response.
                that.state = 'offer-sent';

            } else if (that.state === 'offer-received') {

                that.peerConnection.createAnswer(function (sessionDescription) {
                    L.Logger.debug("Have session description sdp in createAnswer", sessionDescription.sdp);
                    that.peerConnection.setLocalDescription(sessionDescription);
                    that.state = 'offer-received-preparing-answer';

                    if (!that.iceStarted) {
                        var now = new Date();
                        L.Logger.debug(now.getTime() + ': Starting ICE in responder');
                        that.iceStarted = true;
                    } else {
                        that.markActionNeeded();
                        return;
                    }

                }, null, that.mediaConstraints);

            } else if (that.state === 'offer-received-preparing-answer') {
                if (that.moreIceComing) {
                    return;
                }

                mySDP = that.peerConnection.localDescription.sdp;

                that.sendMessage('ANSWER', mySDP);
                that.state = 'established';
            } else {
                that.error('Dazed and confused in state ' + that.state + ', stopping here');
            }
            that.actionNeeded = false;
        }
    };

    /**
     * Internal function to send an "OK" message.
     */
    that.sendOK = function () {
        that.sendMessage('OK');
    };

    /**
     * Internal function to send a signalling message.
     * @param {string} operation What operation to signal.
     * @param {string} sdp SDP message body.
     */
    that.sendMessage = function (operation, sdp) {
        var roapMessage = {};
        roapMessage.messageType = operation;
        roapMessage.sdp = sdp; // may be null or undefined
        if (operation === 'OFFER') {
            roapMessage.offererSessionId = that.sessionId;
            roapMessage.answererSessionId = that.otherSessionId; // may be null
            roapMessage.seq = (that.sequenceNumber += 1);
            // The tiebreaker needs to be neither 0 nor 429496725.
            roapMessage.tiebreaker = Math.floor(Math.random() * 429496723 + 1);
        } else {
            roapMessage.offererSessionId = that.incomingMessage.offererSessionId;
            roapMessage.answererSessionId = that.sessionId;
            roapMessage.seq = that.incomingMessage.seq;
        }
        that.onsignalingmessage(JSON.stringify(roapMessage));
    };

    /**
     * Internal something-bad-happened function.
     * @param {string} text What happened - suitable for logging.
     */
    that.error = function (text) {
        throw 'Error in RoapOnJsep: ' + text;
    };

    that.sessionId = (that.roapSessionId += 1);
    that.sequenceNumber = 0; // Number of last ROAP message sent. Starts at 1.
    that.actionNeeded = false;
    that.iceStarted = false;
    that.moreIceComing = true;
    that.iceCandidateCount = 0;
    that.onsignalingmessage = spec.callback;

    that.peerConnection.onopen = function () {
        if (that.onopen) {
            that.onopen();
        }
    };

    that.peerConnection.onaddstream = function (stream) {
        if (that.onaddstream) {
            that.onaddstream(stream);
        }
    };

    that.peerConnection.onremovestream = function (stream) {
        if (that.onremovestream) {
            that.onremovestream(stream);
        }
    };

    that.peerConnection.oniceconnectionstatechange = function (e) {
        if (that.oniceconnectionstatechange) {
            that.oniceconnectionstatechange(e.currentTarget.iceConnectionState);
        }   
    };

    // Variables that are part of the public interface of PeerConnection
    // in the 28 January 2012 version of the webrtc specification.
    that.onaddstream = null;
    that.onremovestream = null;
    that.state = 'new';
    // Auto-fire next events.
    that.markActionNeeded();
    return that;
};
