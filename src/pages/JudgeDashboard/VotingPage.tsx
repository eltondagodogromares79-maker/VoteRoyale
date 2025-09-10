import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { Crown, LogOut } from "lucide-react";
import axios from "axios";

// Define interfaces
interface Criterion {
  id: number;
  name: string;
  description: string;
  percentage: number;
}

interface Category {
  id: string;
  name: string;
  event: string;
  description: string;
  max_score: number;
  weight: number;
  status: string;
  criteria: Criterion[];
  gender: "male" | "female" | "everyone";
  award_type: "major" | "minor";
}

interface Event {
  id: string;
  title: string;
  description: string;
  date: string;
  status: string;
  location: string;
  max_participants: number;
  coordinatorId: string;
}

interface ParticipantEvent {
  id: string | number; // Allow for both string and number to handle backend response
  title: string;
}

interface Participant {
  id: string;
  name: string;
  event: ParticipantEvent;
  entry: string;
  registration_date: string;
  contestant_number: number;
  email: string;
  origin: string;
  gender: string;
  image: string;
}

interface Vote {
  id: string;
  judgeId: string;
  participantId: string;
  categoryId: string;
  eventId: string;
  score: number;
  comments: string;
  submitted_at?: string;
  participant?: string;
  criteria_scores?: { [key: string]: number };
}

interface User {
  id: string;
  name: string;
  role: string;
  event: string;
}

interface Scores {
  [participantId: string]: {
    [criterionId: number]: number;
  };
}

const VotingPage = () => {
  const { eventId, categoryId } = useParams<{ eventId: string; categoryId: string }>();
  const [searchParams] = useSearchParams();
  const gender = searchParams.get("gender") as "male" | "female" | "everyone" | null;
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [event, setEvent] = useState<Event | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [eventParticipants, setEventParticipants] = useState<Participant[]>([]);
  const [scores, setScores] = useState<Scores>({});
  const [searchTerm, setSearchTerm] = useState("");
  const navigate = useNavigate();
  const { toast } = useToast();

  const API_URL = import.meta.env.VITE_API_URL || "http://192.168.6.195:8000/api";
  const token = localStorage.getItem("accessToken");

  useEffect(() => {
    const fetchData = async () => {
      if (!eventId || !categoryId) {
        toast({
          title: "Error",
          description: "Invalid event or category ID.",
          variant: "destructive",
        });
        navigate("/judge-login");
        return;
      }

      const user = localStorage.getItem("judge");
      if (!user) {
        toast({
          title: "Error",
          description: "User not found. Please log in.",
          variant: "destructive",
        });
        navigate("/judge-login");
        return;
      }

      const userData: User = JSON.parse(user);
      if (userData.role !== "judge") {
        toast({
          title: "Error",
          description: "Unauthorized access. Judges only.",
          variant: "destructive",
        });
        navigate("/judge-login");
        return;
      }

      setCurrentUser(userData);

      try {
        const eventResponse = await axios.get(`${API_URL}/events/${eventId}/`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setEvent(eventResponse.data);

        const categoryResponse = await axios.get(`${API_URL}/events/${eventId}/categories/${categoryId}/`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setCategory(categoryResponse.data);

        const participantsResponse = await axios.get(`${API_URL}/events/judges/dashboard/`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const allParticipants = participantsResponse.data.participants || [];

        // Filter participants by eventId, ensuring type coercion
        const filteredParticipants = allParticipants.filter((participant: Participant) => {
          return String(participant.event.id) === eventId;
        });

        setEventParticipants(filteredParticipants);

        // Initialize scores for filtered participants
        const initialScores: Scores = {};
        filteredParticipants.forEach((participant: Participant) => {
          initialScores[participant.id] = {};
          categoryResponse.data.criteria.forEach((criterion: Criterion) => {
            initialScores[participant.id][criterion.id] = 0;
          });
        });
        setScores(initialScores);
      } catch (error: any) {
        toast({
          title: "Error",
          description: error.response?.data?.error || "Failed to load data. Please try again.",
          variant: "destructive",
        });
        navigate("/judge-login");
      }
    };

    fetchData();
  }, [eventId, categoryId, navigate, toast]);

  const handleScoreChange = (participantId: string, criterionId: number, value: string) => {
    const score = Math.max(1, Math.min(10, parseInt(value) || 0));
    setScores((prevScores) => ({
      ...prevScores,
      [participantId]: {
        ...prevScores[participantId],
        [criterionId]: score,
      },
    }));
  };

  const calculateTotalScore = (participantId: string) => {
    if (!category) return "0";
    const participantScores = scores[participantId];
    let total = 0;
    category.criteria.forEach((criterion) => {
      const score = participantScores[criterion.id] || 0;
      total += (score / 10) * (criterion.percentage / 100) * category.max_score;
    });
    return total.toFixed(1);
  };

  const handleSubmit = async () => {
    if (!currentUser || !event || !category) return;

    // Validate that all scores are entered for participants matching the award's gender
    for (const participant of displayedParticipants) { // Use displayedParticipants instead of eventParticipants
      for (const criterion of category.criteria) {
        if (!scores[participant.id]?.[criterion.id]) {
          toast({
            title: "Missing Scores",
            description: `Please enter a score for ${criterion.name} for ${participant.name}.`,
            variant: "destructive",
          });
          return;
        }
      }
    }

    // Create votes only for participants matching the award's gender
    const newVotes = displayedParticipants.map((participant) => {
      const criteriaScores: { [key: string]: number } = {};
      category.criteria.forEach((criterion) => {
        criteriaScores[criterion.name] = scores[participant.id][criterion.id] || 0;
      });

      return {
        participantId: participant.id,
        score: parseFloat(calculateTotalScore(participant.id)),
        comments: "",
        submittedAt: new Date().toISOString(),
        participant: participant.name,
        criteriaScores,
      };
    });

    try {
      const response = await axios.post(
        `${API_URL}/events/${eventId}/categories/${categoryId}/vote/`,
        { votes: newVotes },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const confirmationData = {
        category: response.data.category,
        votes: response.data.votes,
      };

      toast({
        title: "Scores Submitted",
        description: "Your scores have been successfully submitted.",
      });

      navigate("/judge-dashboard/vote-confirmation", { state: confirmationData });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.response?.data?.error || "Failed to submit scores. Please try again.",
        variant: "destructive",
      });
    }
  };

  const filteredParticipants = eventParticipants.filter((participant) =>
    participant.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Filter participants based on gender
  const displayedParticipants = gender
    ? filteredParticipants.filter((p) => {
        if (gender === "everyone") return true;
        return p.gender.toLowerCase() === gender;
      })
    : filteredParticipants;

  if (!currentUser || !event || !category) {
    return <div className="min-h-screen bg-white flex items-center justify-center">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-[#1A1A1A] text-white border-b-2 border-yellow-500">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Crown className="h-8 w-8 text-yellow-500" />
              <div>
                <h1 className="text-xl font-bold">VoteRoyale</h1>
                <p className="text-sm text-gray-300">Judge Page</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <p className="text-sm text-gray-300">Welcome,</p>
                <p className="font-semibold">{currentUser.name}</p>
              </div>
              <Button
                onClick={() => {
                  localStorage.removeItem("judge");
                  toast({
                    title: "Logged Out",
                    description: "You have been successfully logged out.",
                  });
                  navigate("/judge-login");
                }}
                variant="outline"
                size="sm"
                className="border-yellow-500 text-yellow-500 hover:bg-yellow-500 hover:text-black"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link to="/judge-dashboard/awards">
              <Button variant="outline" className="border-yellow-500 text-yellow-500 hover:bg-yellow-500 hover:text-black">
                ← Back to Awards
              </Button>
            </Link>
            <h1 className="text-2xl font-bold text-black mt-2">{category.name}</h1>
            <p className="text-gray-600">Score contestants for this award category</p>
          </div>
          <span className="inline-block border border-yellow-500 text-yellow-700 px-3 py-1 rounded-full font-semibold bg-yellow-50">
            Open for Voting
          </span>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <Card className="border-yellow-200">
            <CardHeader>
              <CardTitle className="text-black">Award Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <p className="text-gray-600">
                  <span className="font-semibold">Type:</span> {category.award_type.charAt(0).toUpperCase() + category.award_type.slice(1)}
                </p>
                <p className="text-gray-600">
                  <span className="font-semibold">Event:</span> {event.title}
                </p>
                <p className="text-gray-600">
                  <span className="font-semibold">Gender:</span> {category.gender.charAt(0).toUpperCase() + category.gender.slice(1)}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-yellow-200">
            <CardHeader>
              <CardTitle className="text-black">Judging Criteria</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {category.criteria.map((criterion) => (
                  <div key={criterion.id} className="flex justify-between text-gray-600">
                    <span>{criterion.name}:</span>
                    <span className="text-yellow-600">{criterion.percentage}%</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sticky Search Input */}
        <div className="sticky top-0 z-10 bg-gray-50 py-4">
          <input
            type="text"
            placeholder="Search participants..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-yellow-500 bg-white"
          />
        </div>

        <div className="grid md:grid-cols-1 w-full gap-8 justify-self-center align-self-center">
          <div>
            <Card className="border-yellow-200">
              <CardHeader>
                <CardTitle className="text-black">All Candidates({displayedParticipants.filter((p) => p.gender.toLowerCase() === "female").length})</CardTitle>
              </CardHeader>
              <CardContent>
                {displayedParticipants
                  .filter((participant) => participant.gender.toLowerCase() === "female")
                  .map((participant) => (
                    <div key={participant.id} className="mb-6">
                      <div className="flex items-center space-x-4 mb-4">
                        <img
                          src={participant.image || "https://via.placeholder.com/48"}
                          alt={participant.name}
                          className="w-40 h-40 object-cover rounded-xl border-2 border-yellow-500"
                        />
                        <div>
                          <h4 className="text-black font-semibold">
                            {participant.name} - #{participant.contestant_number} - {participant.origin}
                          </h4>
                        </div>
                      </div>
                      {category.criteria.map((criterion) => (
                        <div key={criterion.id} className="flex items-center justify-between mb-2">
                          <span className="text-gray-600">
                            {criterion.name} <span className="text-yellow-600">{criterion.percentage}%</span>
                          </span>
                          <div className="flex items-center space-x-2">
                            <input
                              type="number"
                              min="1"
                              max="10"
                              value={scores[participant.id]?.[criterion.id] || ""}
                              onChange={(e) =>
                                handleScoreChange(participant.id, criterion.id, e.target.value)
                              }
                              className="w-16 p-1 border border-gray-300 rounded text-center"
                            />
                            <span className="text-gray-600">/ 10</span>
                          </div>
                        </div>
                      ))}
                      <div className="flex justify-between mt-4 pt-2 border-t border-gray-200">
                        <span className="text-gray-700 font-semibold">Total Score:</span>
                        <span className="text-yellow-600 font-semibold">{calculateTotalScore(participant.id)}</span>
                      </div>
                    </div>
                  ))}
              </CardContent>
            </Card>
          </div>

{/*           <div>
            <Card className="border-yellow-200">
              <CardHeader>
                <CardTitle className="text-black">Male Contestants ({displayedParticipants.filter((p) => p.gender.toLowerCase() === "male").length})</CardTitle>
              </CardHeader>
              <CardContent>
                {displayedParticipants
                  .filter((participant) => participant.gender.toLowerCase() === "male")
                  .map((participant) => (
                    <div key={participant.id} className="mb-6">
                      <div className="flex items-center space-x-4 mb-4">
                        <img
                          src={participant.image || "https://via.placeholder.com/48"}
                          alt={participant.name}
                          className="w-40 h-40 object-cover rounded-xl border-2 border-yellow-500"
                        />
                        <div>
                          <h4 className="text-black font-semibold">
                            {participant.name} - #{participant.contestant_number} - {participant.origin}
                          </h4>
                        </div>
                      </div>
                      {category.criteria.map((criterion) => (
                        <div key={criterion.id} className="flex items-center justify-between mb-2">
                          <span className="text-gray-600">
                            {criterion.name} <span className="text-yellow-600">{criterion.percentage}%</span>
                          </span>
                          <div className="flex items-center space-x-2">
                            <input
                              type="number"
                              min="1"
                              max="10"
                              value={scores[participant.id]?.[criterion.id] || ""}
                              onChange={(e) =>
                                handleScoreChange(participant.id, criterion.id, e.target.value)
                              }
                              className="w-16 p-1 border border-gray-300 rounded text-center"
                            />
                            <span className="text-gray-600">/ 10</span>
                          </div>
                        </div>
                      ))}
                      <div className="flex justify-between mt-4 pt-2 border-t border-gray-200">
                        <span className="text-gray-700 font-semibold">Total Score:</span>
                        <span className="text-yellow-600 font-semibold">{calculateTotalScore(participant.id)}</span>
                      </div>
                    </div>
                  ))}
              </CardContent>
            </Card>
          </div> */}
        </div>

        <div className="mt-8 text-center">
          <Button
            onClick={handleSubmit}
            className="bg-yellow-600 hover:bg-yellow-700 text-black py-3 px-6 text-lg"
          >
            Submit Scores
          </Button>
        </div>
      </div>
    </div>
  );
};

export default VotingPage;
