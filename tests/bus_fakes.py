from types import SimpleNamespace


def bus_state(route="[22]", destination="京阪香里園行", status="約3分後に到着", timetable="17:20 到着予定",
              scheduled_time=None, delay_text=None, delay_minutes=None, dgmpl=None, order=1):
    prms = SimpleNamespace(route=route, destination=destination, via="", status=status, timetable=timetable,
                           order=order, lat=0, lon=0)
    return SimpleNamespace(busstateprms=prms, scheduled_time=scheduled_time, delay_text=delay_text,
                           delay_minutes=delay_minutes, dgmpl=dgmpl)


def bus_response(*states):
    return SimpleNamespace(body=SimpleNamespace(datetimeStr="2026/11/14 17:10", busstates=list(states)))
