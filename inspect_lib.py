
import keihan_tracker
import inspect

with open("tracker_info.txt", "w", encoding="utf-8") as f:
    f.write(f"Version: {getattr(keihan_tracker, '__version__', 'Unknown')}\n")
    f.write(f"KHTracker members: {dir(keihan_tracker.KHTracker)}\n")
    
    # Inspect StationData
    if hasattr(keihan_tracker, 'StationData'):
        f.write("\nStationData annotations:\n")
        try:
            f.write(str(keihan_tracker.StationData.__annotations__))
        except:
            f.write("No annotations")
            
    # Inspect TrainData
    if hasattr(keihan_tracker, 'TrainData'):
        f.write("\nTrainData annotations:\n")
        try:
             f.write(str(keihan_tracker.TrainData.__annotations__))
        except:
             f.write("No annotations")

    # Check KHTracker.stations type if possible (by instantiation if safe)
    # We won't instantiate to avoid side effects or async issues in this simple script
