from flask import Flask, jsonify, request, session

from vibe_engine import (
    interpret_vibe,
    track_vector,
    hybrid_score,
    get_emotion,
    apply_repeat_penalty
)

from memory import log_track_interaction, get_user_history

from cache import load_user_tracks


@app.route("/generate", methods=["POST"])
def generate():
    if "user_id" not in session:
        return {"error": "not logged in"}, 401

    user_id = session["user_id"]
    data = request.get_json(force=True)
    vibe_text = data.get("vibe", "").strip()

    if not vibe_text:
        return {"error": "missing vibe"}, 400

    tracks = load_user_tracks(user_id)

    if not tracks:
        return {"error": "no tracks found"}, 404

    vibe_vec = interpret_vibe(vibe_text)
    history = get_user_history(user_id)

    scored = []

    for t in tracks:

        t_vec = track_vector(t)

        score = hybrid_score(vibe_vec, t_vec, t)

        score = apply_repeat_penalty(history, t.spotify_id, score)

        emotion = get_emotion(t_vec)

        log_track_interaction(
            user_id=user_id,
            track_id=t.spotify_id,
            emotion=emotion,
            score=score
        )

        scored.append((score, t))

    scored.sort(key=lambda x: x[0], reverse=True)
    top = [t for _, t in scored[:30]]

    return jsonify({
        "vibe": vibe_text,
        "tracks": [
            {
                "name": t.name,
                "artist": t.artist,
                "album": t.album,
                "spotify_id": t.spotify_id
            }
            for t in top
        ]
    })
